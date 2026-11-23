#!/usr/bin/env python3
"""Functional test of the front in front of a real Mailu.

Talks to the listeners the way Traefik does: a PROXY v2 header first, then the
plaintext mail protocol. Everything a mail client can observe goes through
here: the dialogue before the login (spoken by the front itself), the login
(decided by admin), and the session after it (relayed to dovecot or postfix).

Usage: mailtest.py <path to mailu.env>
"""
import base64
import http.client
import pathlib
import socket
import struct
import sys
import time
import uuid

HOST = "127.0.0.1"
# public port -> port published by compose.yaml
PORTS = {465: 20465, 993: 20993, 995: 20995}
HEALTH_PORT = 20080
# The address the PROXY header claims for the client. run.sh looks for it in the logs.
CLIENT_IP = "203.0.113.7"
# Longer than the 60 s nginx waits for a login, so the relay is what holds the session
IDLE_SECONDS = 75
LARGE_MAIL_MEGABYTES = 20

env = dict(
    line.split("=", 1)
    for line in pathlib.Path(sys.argv[1]).read_text().splitlines()
    if "=" in line and not line.startswith("#")
)
USER = f'{env["INITIAL_ADMIN_ACCOUNT"]}@{env["INITIAL_ADMIN_DOMAIN"]}'
PASSWORD = env["INITIAL_ADMIN_PW"]
SIZE_LIMIT = env["MESSAGE_SIZE_LIMIT"]

results = []


def record(name, ok, detail=""):
    results.append((name, ok))
    print(f'{"ok  " if ok else "FAIL"} {name}{": " + detail if detail else ""}', flush=True)


def wrong_password():
    return "wrong-" + uuid.uuid4().hex[:6]


def proxy_v2(port):
    addresses = socket.inet_aton(CLIENT_IP) + socket.inet_aton("198.51.100.1") + struct.pack("!HH", 40000, port)
    return b"\r\n\r\n\x00\r\nQUIT\n" + bytes([0x21, 0x11]) + struct.pack("!H", len(addresses)) + addresses


class Conn:
    def __init__(self, port, timeout=30):
        self.sock = socket.create_connection((HOST, PORTS[port]), timeout=timeout)
        self.sock.sendall(proxy_v2(port))
        self.file = self.sock.makefile("rb")

    def line(self):
        raw = self.file.readline()
        if not raw:
            raise ConnectionError("connection closed")
        return raw.decode(errors="replace").rstrip("\r\n")

    def send(self, text):
        self.sock.sendall(text.encode() + b"\r\n")

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


def imap_cmd(conn, tag, command):
    conn.send(f"{tag} {command}")
    untagged = []
    while True:
        line = conn.line()
        if line.startswith(tag + " "):
            return line, untagged
        untagged.append(line)


def imap_session(timeout=30):
    conn = Conn(993, timeout=timeout)
    conn.line()
    imap_cmd(conn, "s1", f'LOGIN "{USER}" "{PASSWORD}"')
    imap_cmd(conn, "s2", "SELECT INBOX")
    return conn


def smtp_reply(conn):
    lines = []
    while True:
        line = conn.line()
        lines.append(line)
        if len(line) < 4 or line[3] != "-":
            return int(line[:3]), lines


def smtp_cmd(conn, command):
    conn.send(command)
    return smtp_reply(conn)


def smtp_session(timeout=30):
    conn = Conn(465, timeout=timeout)
    smtp_reply(conn)
    smtp_cmd(conn, "EHLO client.test.example")
    return conn, smtp_cmd(conn, "AUTH PLAIN " + plain(USER, PASSWORD))


def plain(user, password):
    return base64.b64encode(f"\0{user}\0{password}".encode()).decode()


def headers(subject, token):
    return (
        f"From: <{USER}>\r\nTo: <{USER}>\r\nSubject: {subject} {token}\r\n"
        f"Message-ID: <{token}@test.example>\r\n"
        f"Date: {time.strftime('%a, %d %b %Y %H:%M:%S +0000', time.gmtime())}\r\n\r\n"
    )


def find_mail(token):
    """Sequence number of the message with the token in its subject, or None."""
    conn = imap_session()
    _, untagged = imap_cmd(conn, "f1", f'SEARCH SUBJECT "{token}"')
    imap_cmd(conn, "f2", "LOGOUT")
    conn.close()
    numbers = [n for line in untagged if line.startswith("* SEARCH") for n in line.split()[2:]]
    return numbers[0] if numbers else None


def wait_for_mail(token, seconds=120):
    """Sequence number of the message once it is in the INBOX, or None."""
    deadline = time.time() + seconds
    while time.time() < deadline:
        number = find_mail(token)
        if number:
            return number
        time.sleep(4)
    return None


def wait_until_ready(seconds=240):
    deadline = time.time() + seconds
    last = ""
    while time.time() < deadline:
        try:
            conn = Conn(993)
            greeting = conn.line()
            status, _ = imap_cmd(conn, "w1", f'LOGIN "{USER}" "{PASSWORD}"')
            conn.close()
            if greeting.startswith("* OK") and status.startswith("w1 OK"):
                return True
            last = status
        except OSError as exc:
            last = repr(exc)
        time.sleep(5)
    print("not ready:", last)
    return False


def wait_until_smtp_accepts(seconds=300):
    """Postfix answers 451 until its milter (rspamd) is up."""
    deadline = time.time() + seconds
    last = ""
    while time.time() < deadline:
        try:
            conn, _ = smtp_session()
            code, lines = smtp_cmd(conn, f"MAIL FROM:<{USER}>")
            conn.close()
            if code == 250:
                return True
            last = lines[-1]
        except OSError as exc:
            last = repr(exc)
        time.sleep(5)
    print("smtp not ready:", last)
    return False


def quiet_send(token):
    conn, _ = smtp_session()
    smtp_cmd(conn, f"MAIL FROM:<{USER}>")
    smtp_cmd(conn, f"RCPT TO:<{USER}>")
    smtp_cmd(conn, "DATA")
    code, _ = smtp_cmd(conn, headers("warmup", token) + "warm-up\r\n.")
    conn.close()
    return code == 250


def wait_until_delivery_works(attempts=8):
    """Right after start postfix defers mail until admin answers its transport lookups."""
    for _ in range(attempts):
        token = uuid.uuid4().hex
        if quiet_send(token) and wait_for_mail(token, seconds=30):
            return True
    return False


def test_health():
    conn = http.client.HTTPConnection(HOST, HEALTH_PORT, timeout=10)
    conn.request("GET", "/health")
    status = conn.getresponse().status
    conn.close()
    record("health endpoint for the probes", status == 204, str(status))


def test_imap():
    conn = Conn(993)
    greeting = conn.line()
    record("993 greeting", greeting.startswith("* OK"), greeting)
    status, untagged = imap_cmd(conn, "a0", "CAPABILITY")
    record("993 offers AUTH=PLAIN before login", any("AUTH=PLAIN" in line for line in untagged), " ".join(untagged))
    status, _ = imap_cmd(conn, "a1", f'LOGIN "{USER}" "{wrong_password()}"')
    record("993 wrong password is rejected", status.startswith("a1 NO"), status)
    conn.close()

    conn = Conn(993)
    conn.line()
    status, _ = imap_cmd(conn, "a1", f'LOGIN "{USER}" "{PASSWORD}"')
    record("993 login", status.startswith("a1 OK"), status[:60])
    status, untagged = imap_cmd(conn, "a2", 'LIST "" "*"')
    record("993 LIST shows INBOX", any("INBOX" in line for line in untagged), f"{len(untagged)} mailboxes")
    imap_cmd(conn, "a3", "LOGOUT")
    conn.close()


def test_submission():
    conn = Conn(465)
    code, lines = smtp_reply(conn)
    record("465 greeting", code == 220, lines[-1])
    code, lines = smtp_cmd(conn, "EHLO client.test.example")
    record("465 EHLO offers AUTH PLAIN", code == 250 and any("AUTH" in l and "PLAIN" in l for l in lines), lines[-1])
    record(
        "465 EHLO advertises the size limit of postfix",
        any(l[4:] == f"SIZE {SIZE_LIMIT}" for l in lines),
        f"SIZE {SIZE_LIMIT}",
    )
    code, lines = smtp_cmd(conn, "AUTH PLAIN " + plain(USER, wrong_password()))
    record("465 wrong password is rejected", code == 535, lines[-1])
    conn.close()

    token = uuid.uuid4().hex
    conn, (code, lines) = smtp_session()
    record("465 AUTH", code == 235, lines[-1])
    code, lines = smtp_cmd(conn, f"MAIL FROM:<{USER}>")
    record("465 MAIL FROM", code == 250, lines[-1])
    code, lines = smtp_cmd(conn, f"RCPT TO:<{USER}>")
    record("465 RCPT TO", code == 250, lines[-1])
    code, lines = smtp_cmd(conn, "DATA")
    record("465 DATA", code == 354, lines[-1])
    code, lines = smtp_cmd(conn, headers("fronttest", token) + "Hello through the front.\r\n.")
    record("465 message accepted", code == 250, lines[-1])
    conn.close()
    record("mail sent via 465 arrives in INBOX", bool(wait_for_mail(token)), token[:8])


def test_pop3():
    conn = Conn(995)
    greeting = conn.line()
    record("995 greeting", greeting.startswith("+OK"), greeting)
    conn.send(f"USER {USER}")
    conn.line()
    conn.send(f"PASS {wrong_password()}")
    reply = conn.line()
    record("995 wrong password is rejected", reply.startswith("-ERR"), reply)
    conn.close()

    conn = Conn(995)
    conn.line()
    conn.send(f"USER {USER}")
    conn.line()
    conn.send(f"PASS {PASSWORD}")
    reply = conn.line()
    record("995 login", reply.startswith("+OK"), reply)
    conn.send("STAT")
    reply = conn.line()
    record("995 STAT", reply.startswith("+OK"), reply)
    conn.send("QUIT")
    conn.close()


def test_idle():
    conn = imap_session(timeout=IDLE_SECONDS + 60)
    conn.send("i1 IDLE")
    continuation = conn.line()
    started = time.time()
    time.sleep(IDLE_SECONDS)
    conn.send("DONE")
    answer = ""
    while not answer.startswith("i1 "):
        answer = conn.line()
    held = int(time.time() - started)
    status, _ = imap_cmd(conn, "i2", "NOOP")
    conn.close()
    ok = continuation.startswith("+") and answer.startswith("i1 OK") and status.startswith("i2 OK")
    record(f"993 IDLE survives {held} s", ok, answer)


def test_large_mail():
    token = uuid.uuid4().hex
    line = ("0123456789" * 7 + "012345\r\n").encode()
    body = line * (LARGE_MAIL_MEGABYTES * 1024 * 1024 // len(line))
    head = headers("big", token).encode()
    conn, _ = smtp_session(timeout=300)
    smtp_cmd(conn, f"MAIL FROM:<{USER}> SIZE={len(head) + len(body)}")
    smtp_cmd(conn, f"RCPT TO:<{USER}>")
    smtp_cmd(conn, "DATA")
    conn.sock.sendall(head + body + b".\r\n")
    code, lines = smtp_reply(conn)
    conn.close()
    record(f"465 accepts a mail of {LARGE_MAIL_MEGABYTES} MB", code == 250, lines[-1])

    size = 0
    number = wait_for_mail(token, seconds=180)
    if number:
        conn = imap_session()
        _, untagged = imap_cmd(conn, "l1", f"FETCH {number} RFC822.SIZE")
        conn.close()
        size = max((int(l.split("RFC822.SIZE")[1].strip(" )")) for l in untagged if "RFC822.SIZE" in l), default=0)
    record(f"the mail of {LARGE_MAIL_MEGABYTES} MB arrives complete", size >= len(body), f"{size} bytes in the mailbox")


def main():
    if not wait_until_ready():
        record("stack ready", False)
        return 1
    record("stack ready", True)
    record("postfix accepts mail (milter up)", wait_until_smtp_accepts())
    record("delivery to the mailbox works (warm-up)", wait_until_delivery_works())
    for test in (test_health, test_imap, test_submission, test_pop3, test_idle, test_large_mail):
        try:
            test()
        except (OSError, ValueError, IndexError) as exc:
            # A dropped connection or an unexpected answer fails this test, not the whole run
            record(test.__name__, False, repr(exc))
    failed = [name for name, ok in results if not ok]
    print(f"\n{len(results) - len(failed)} of {len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

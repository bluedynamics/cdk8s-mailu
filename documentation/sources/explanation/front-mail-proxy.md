# The front mail proxy

The front is the door for mail clients: it accepts SMTPS (465), IMAPS (993), and POP3S (995) sessions and authenticates each of them.
This page explains why the door exists and how it decides who may pass.
It also explains why the front is a plain nginx instead of the Mailu front image.

(front-why-a-proxy)=

## Why a proxy stands in front of postfix and dovecot

Postfix and dovecot in a Mailu deployment do not verify passwords for sessions that arrive from the configured `subnet`.
Mailu designed them as backends that trust whatever stands in front of them.
Something else has to check the password before a session reaches them.

That something is the mail proxy of nginx.
It speaks SMTP, IMAP, and POP3 with the client until the client has sent its credentials.
It asks the Mailu admin whether the credentials are valid.
On success it opens a connection to the backend that admin names and logs in on behalf of the client.
From then on it relays the session.

The front is the only authentication gate for mail clients.
You cannot remove it and point Traefik at dovecot directly.
For the same reason, treat `subnet` as a trust boundary: whoever reaches the backend ports from inside it bypasses the front.
The library does not create network policies.

(front-contract-with-admin)=

## The contract with admin

For every login nginx sends one HTTP request to `/internal/auth/email` on the admin Service.
The request carries the credentials and the circumstances of the login in headers.
Admin answers with `Auth-Status`, and on success with the address and port of the backend.

nginx sends most headers on its own: `Auth-Method`, `Auth-User`, `Auth-Pass`, `Auth-Protocol`, and `Client-IP`.
Admin needs two more, `Auth-Port` and `Client-Port`, and fails without them.
The Mailu front image adds them in its configuration template.
The configuration of the library adds them with `auth_http_header` in every listener:

```nginx
server {
    listen 10993 proxy_protocol;
    protocol imap;
    imap_auth plain;
    auth_http_header Auth-Port 993;
    auth_http_header Client-Port $remote_port;
}
```

`Auth-Port` is more than a log field.
Admin reads the port to tell mail clients from the webmail.
The values 10025, 10143, and 14190 mean "this is the webmail".
For them admin accepts the session tokens of the webmail, and for the first two it skips the rate limit.
The header therefore always carries the public port, never the port the container listens on.
The container ports are chosen so that none of them collides with those three values.

The listeners offer only the `plain` mechanism.
Admin has to see the password to check it, and Traefik has already wrapped the session in TLS.

(front-client-address)=

## The client address and the rate limit

Traefik terminates TLS and opens a new connection to the front.
Without further measures every session seems to come from Traefik.

That matters because admin limits failed logins per client network.
When all sessions share one address, they share one bucket.
A single attacker who guesses passwords then locks out every legitimate user.

The PROXY protocol solves this.
With `ingress.traefik.proxyProtocolToFront` enabled, Traefik sends the address of the real client in a header before the mail protocol starts.
The listeners of the front expect that header, and `set_real_ip_from` makes nginx use the address from it.
nginx trusts the header only when the connection comes from `subnet`.

Both sides have to agree.
A listener that waits for a header Traefik never sends hangs every session.
A header that the listener does not expect breaks the session as well.
The chart derives the Traefik routes and the front configuration from the same option.

The client address travels further from there.
Admin gets it in `Client-IP`, postfix gets it through `XCLIENT`, and nginx writes it to its log for every failed login:

```text
2026/11/22 21:40:08 [info] 21#21: *29 client login failed: "Authentication credentials invalid" while in http auth state, client: 203.0.113.7, server: 0.0.0.0:10993, login: "user@example.com"
```

Intrusion detection such as CrowdSec or fail2ban parses this line.
nginx writes it at level `info`, which is why the configuration sets `error_log /dev/stderr info`.

(front-official-nginx)=

## Why the official nginx image

Up to version 0.4 the front ran the Mailu front image.
That image renders its nginx configuration from templates at start.
With TLS terminated by Traefik the result lacked the mail listeners, and a wrapper script patched them in before nginx started.

By then most duties of the Mailu front had moved elsewhere.
Traefik terminates TLS and routes HTTP straight to admin and the webmail.
Port 25 goes straight to postfix.
What remained was the mail proxy, a few dozen lines of configuration.

Since version 0.5 the front is the official nginx image with exactly those lines:

- The configuration is complete in the ConfigMap.
  What you read in the manifest is what runs, and nothing rewrites it at start.
- nginx gets security fixes on its own schedule, independent of Mailu releases.
- The container needs no Mailu environment and no secret.
- It runs as an unprivileged user on a read-only root filesystem without capabilities.

The price is that the library now owns the contract with admin.
When Mailu changes what admin expects, the configuration has to follow.
An integration test guards this.
It runs the rendered configuration against a Mailu built from the original images.
It checks logins, delivery, and the logs of admin and postfix.

nginx reads its configuration only at start.
The pod template therefore carries a checksum of the configuration, and every change rolls the pod.

(front-unprivileged-ports)=

## Unprivileged ports

A process without root and without capabilities cannot bind ports below 1024.
nginx listens on 10465, 10993, and 10995 inside the container.
The Service keeps the public ports 465, 993, and 995 and maps them to the container ports.
Traefik and everything else in the cluster see only the Service.

A fourth port, 8080, serves `/health` for the probes.
A TCP probe on a mail port would work, but it sends no PROXY header, and nginx would log an error for every probe.

(front-what-it-does-not-do)=

## What the front does not do

- It does not terminate TLS.
  Traefik does.
- It does not serve HTTP for admin or the webmail.
  The Ingress routes those directly.
- It does not receive mail from other servers.
  Port 25 goes from Traefik to postfix.
- It does not offer submission on port 587.
  Traefik cannot terminate STARTTLS for SMTP, and a plain listener would offer `AUTH` without TLS.
  Mail clients submit with implicit TLS on port 465.
- It does not serve the webmail.
  The webmail talks to dovecot and to the dovecot submission service directly.

```{seealso}
- [Authentication flows](authentication-flows.md) for the other login paths
- [Component specifications](../reference/component-specifications.md) for ports, image, and resources of the front
- [Configure TLS](../how-to/configure-tls.md) for the Traefik side
```

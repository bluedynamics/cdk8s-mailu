# Documentation and Code Fixes Plan

**Created**: 2025-11-11
**Status**: In Progress

## Executive Summary

Comprehensive review of cdk8s-mailu documentation vs implementation identified **12 major discrepancies** and **8 improvement opportunities**. This plan addresses critical port documentation errors, missing authentication flow explanations, and architecture diagram enhancements.

---

## 1. CRITICAL FINDINGS

### 1.1 Port Documentation Errors (HIGH SEVERITY)

#### Admin Service Port Incorrect
- **Location**: `documentation/sources/reference/component-specifications.md:59-60`
- **Documentation says**: Port 80/TCP
- **Code reality**: Port 8080/TCP (`admin-construct.ts:75, 208`)
- **Impact**: Developers cannot manually connect to admin service
- **Fix**: Change documentation from 80 → 8080, add note about internal vs ingress ports

#### Postfix Port 10025 Description Wrong
- **Location**: `documentation/sources/reference/component-specifications.md:94-97`
- **Documentation says**: "10025/TCP - LMTP (delivery from rspamd)"
- **Code reality**: Port 10025 is internal submission relay from dovecot-submission (`postfix-construct.ts:174-186`)
- **Issue**: LMTP is NOT exposed as service port (LMTP is internal protocol on port 2525)
- **Impact**: Completely misrepresents mail flow architecture
- **Fix**: Change to "10025/TCP - Internal submission relay (from dovecot-submission service)"

#### Missing Dovecot LMTP Port
- **Documentation**: No mention of port 2525
- **Code reality**: Dovecot exposes LMTP on port 2525 (`dovecot-construct.ts:166-170`)
- **Impact**: Missing critical mail delivery flow information
- **Fix**: Add "2525/TCP - LMTP (mail delivery from Postfix)" to Dovecot ports

#### Missing Rspamd Milter Port
- **Documentation**: No mention of port 11332
- **Code reality**: Rspamd exposes milter protocol on port 11332 (`rspamd-construct.ts:143`)
- **Impact**: Missing critical spam filtering flow information
- **Fix**: Add "11332/TCP - Milter (spam scanning from Postfix)" to Rspamd ports

### 1.2 Architecture Diagram Issues

#### Missing Port Numbers
- **Location**: `documentation/sources/explanation/architecture.md:14-33`
- **Issue**: Mermaid diagram shows connections but not port numbers
- **Missing ports**:
  - Dovecot LMTP: 2525
  - Admin auth_http: 8080
  - Rspamd milter: 11332
  - Dovecot-submission: 10025
- **Fix**: Add port labels to all diagram arrows (e.g., `Postfix -->|LMTP:2525| Dovecot`)

#### Mail Flow Sequence Unclear
- **Issue**: Diagram shows Postfix → Rspamd and Postfix → Dovecot as parallel, not sequential
- **Reality**: Mail flow is sequential:
  1. Postfix receives mail (port 25)
  2. Postfix → Rspamd:11332 (milter scan - inline, not parallel)
  3. Rspamd → Postfix (scan results)
  4. Postfix → Dovecot:2525 (LMTP delivery)
- **Fix**: Add "Mail Delivery Flow Details" section with sequence diagram

### 1.3 FRONT_ADDRESS Naming Confusion (MEDIUM SEVERITY)

- **Location**: `mailu-chart.ts:384-388`, `architecture.md`
- **Issue**: Variable named `FRONT_ADDRESS` actually points to Dovecot service, not Front service
- **Documentation says** (mailu-chart.ts:384-387):
  ```
  // FRONT_ADDRESS is used for LMTP delivery (postfix -> dovecot:2525)
  // Despite the name, it should point to dovecot, not the nginx front service
  ```
- **Impact**: Confusing for developers - variable name implies Front service but points elsewhere
- **Root cause**: Mailu naming convention (not cdk8s-mailu decision)
- **Fix**: Add prominent callout in documentation explaining this naming quirk

---

## 2. AUTHENTICATION FLOW GAPS

### 2.1 Missing Nginx auth_http Explanation
- **Documentation mentions**: "Authentication proxy using Admin's auth_http endpoint"
- **Missing details**:
  - How nginx auth_http protocol works
  - What happens when user connects to IMAP/SMTP via Front
  - How credentials are passed to Admin
  - What Admin returns to nginx
- **Code evidence**: `nginx-patch-configmap.ts:58` shows auth_http endpoint patching
- **Fix**: Create dedicated authentication flows documentation

### 2.2 Dovecot-Submission "Token Auth" Misleading
- **Location**: `documentation/sources/explanation/dovecot-submission.md:46-49, 196-199`
- **Documentation says**: "Token authentication" with token validation at webmail level
- **Code reality** (`dovecot-submission-construct.ts:196-200`):
  ```
  passdb {
    driver = static
    args = nopassword=y
  }
  ```
- **Issue**: Documentation claims "token authentication" but dovecot accepts anything (nopassword=y)
- **Reality**:
  - Trust is based on **network isolation** (only webmail can connect)
  - "Token" is just webmail session, not validated by dovecot-submission
  - Dovecot-submission is a relay-only service
- **Fix**: Rewrite to emphasize network trust model, not token validation

### 2.3 Webmail SSO Authentication Unexplained
- **Documentation mentions**: "SSO integration via Admin's SSO service"
- **Missing details**:
  - What SSO protocol (cookies? tokens?)
  - How webmail validates sessions with admin
  - Login flow sequence
  - How SSO relates to email sending authentication
- **Fix**: Add detailed webmail authentication flow diagram

---

## 3. MISSING DOCUMENTATION PAGES

### 3.1 Authentication Flows (NEW PAGE NEEDED)
- **File**: `documentation/sources/explanation/authentication-flows.md`
- **Content needed**:
  1. **Nginx auth_http flow** (IMAP/SMTP client → Front → Admin validation)
  2. **Webmail SSO flow** (User login → Admin → Session creation)
  3. **Dovecot-submission relay trust** (Network isolation, not token validation)
- **Include**: Sequence diagrams for each flow

### 3.2 Nginx Configuration Patches (NEW PAGE NEEDED)
- **File**: `documentation/sources/explanation/nginx-configuration-patches.md`
- **Content needed**:
  1. **TLS_FLAVOR=notls** architecture decision
  2. **Why patches needed** (Traefik TLS termination implications)
  3. **Each patch explained** with before/after examples:
     - auth_http endpoint path change
     - Mail protocol port injection (465, 587, 993, 995)
     - Admin location block
     - Webmail redirect
  4. **Verification** checks in wrapper script
- **Code reference**: `nginx-patch-configmap.ts:37-102`

### 3.3 Storage Architecture (NEW PAGE NEEDED)
- **File**: `documentation/sources/explanation/storage-architecture.md`
- **Content needed**:
  1. **What each PVC stores**:
     - Admin: DKIM keys, config, SQLite (if not PostgreSQL)
     - Postfix: Mail queue
     - Dovecot: Mailboxes (/mail)
     - Rspamd: Bayes data, statistics
     - Webmail: Session data, temp files (need to clarify PostgreSQL vs SQLite)
  2. **Backup/restore strategies**
  3. **Sizing guidelines** beyond defaults
  4. **Data loss implications** per component

---

## 4. COMPLETE PORT REFERENCE

### 4.1 All Ports by Component

| Component | Port | Protocol | Purpose | Service Exposed | Code Reference |
|-----------|------|----------|---------|-----------------|----------------|
| **Admin** | 8080 | HTTP | Admin API and web interface | ✓ | admin-construct.ts:208 |
| **Admin** | 8080 | HTTP | auth_http endpoint (/internal/auth/email) | ✓ | nginx-patch-configmap.ts:58 |
| **Front** | 80 | HTTP | Web traffic (admin, webmail) | ✓ | front-construct.ts:148 |
| **Front** | 443 | HTTPS | Web traffic (with Traefik TLS) | ✓ | front-construct.ts:149 |
| **Front** | 25 | SMTP | Mail reception (MX) | ✓ | front-construct.ts:150 |
| **Front** | 465 | SMTPS | SMTP over TLS | ✓ | front-construct.ts:151 |
| **Front** | 587 | Submission | SMTP submission with STARTTLS | ✓ | front-construct.ts:152 |
| **Front** | 143 | IMAP | Mail retrieval | ✓ | front-construct.ts:153 |
| **Front** | 993 | IMAPS | IMAP over TLS | ✓ | front-construct.ts:154 |
| **Front** | 110 | POP3 | Mail retrieval | ✓ | front-construct.ts:155 |
| **Front** | 995 | POP3S | POP3 over TLS | ✓ | front-construct.ts:156 |
| **Postfix** | 25 | SMTP | SMTP relay and MX reception | ✓ | postfix-construct.ts:177 |
| **Postfix** | 10025 | Submission | Internal relay from dovecot-submission | ✓ | postfix-construct.ts:180 |
| **Dovecot** | 2525 | LMTP | Mail delivery from Postfix | ✓ | dovecot-construct.ts:166 |
| **Dovecot** | 143 | IMAP | Mail retrieval | ✓ | dovecot-construct.ts:172 |
| **Dovecot** | 993 | IMAPS | IMAP over TLS | ✓ | dovecot-construct.ts:175 |
| **Dovecot** | 110 | POP3 | Mail retrieval | ✓ | dovecot-construct.ts:178 |
| **Dovecot** | 995 | POP3S | POP3 over TLS | ✓ | dovecot-construct.ts:181 |
| **Dovecot** | 4190 | Sieve | ManageSieve (NEEDS VERIFICATION) | ? | **MISSING?** |
| **Dovecot-Sub** | 10025 | Submission | SMTP relay from webmail | ✓ | dovecot-submission-construct.ts:125 |
| **Rspamd** | 11332 | Milter | Spam scanning from Postfix | ✓ | rspamd-construct.ts:143 |
| **Rspamd** | 11334 | HTTP | Web UI and API | ✓ | rspamd-construct.ts:155 |
| **Webmail** | 80 | HTTP | Webmail interface | ✓ | webmail-construct.ts:216 |
| **ClamAV** | 3310 | ClamAV | Antivirus scanning | ✓ | clamav-construct.ts:131 |

**Notes**:
- Port 4190 (ManageSieve) documented but NOT in dovecot service definition - needs investigation
- All "TLS" ports receive plaintext with TLS_FLAVOR=notls (Traefik handles TLS)

---

## 5. MAIL DELIVERY FLOW DETAILS

### 5.1 Inbound Mail (Internet → Mailbox)
```
1. Internet → Traefik IngressRouteTCP:25
2. Traefik → Front:25
3. Front (nginx) → Postfix:25
4. Postfix → Rspamd:11332 (milter protocol - inline scan)
5. Rspamd → Postfix (scan results: accept/reject/quarantine)
6. Postfix → Dovecot:2525 (LMTP delivery)
7. Dovecot stores in /mail PVC
```

**Key points**:
- Rspamd scan is **inline** (mail passes through), not parallel
- Front adds auth_http check only for ports 587/993/995 (authenticated submission/retrieval)
- Port 25 (MX) bypasses auth (accepts from anywhere)

### 5.2 Webmail Sending (User → Internet via Webmail)
```
1. User → Browser → Webmail:80
2. Webmail authenticates user via Admin SSO
3. User composes email in webmail
4. Webmail → Dovecot-Submission:10025 (with session "token")
5. Dovecot-Submission accepts (nopassword=y trust model)
6. Dovecot-Submission → Postfix:25 (relay without auth)
7. Postfix → Internet
```

**Key points**:
- "Token" is just webmail session, not validated by dovecot-submission
- Trust based on network isolation (only webmail pod can reach dovecot-submission:10025)
- Dovecot-submission is relay-only service

### 5.3 Authenticated SMTP/IMAP (Mail Client → Server)
```
1. Mail client → Traefik:587/993/995
2. Traefik (TLS termination) → Front:587/993/995 (plaintext)
3. Front (nginx) → Admin:8080/internal/auth/email (auth_http check)
4. Admin validates credentials against PostgreSQL
5. Admin → Front (HTTP 200 with backend address, or 403 reject)
6. If authenticated:
   - SMTP (587): Front → Postfix:25
   - IMAP (993): Front → Dovecot:143
   - POP3 (995): Front → Dovecot:110
```

---

## 6. CODE ISSUES TO INVESTIGATE

### 6.1 Dovecot ManageSieve Port Missing (MEDIUM SEVERITY)
- **Documentation**: Claims port 4190 (ManageSieve) exists
- **Code**: `dovecot-construct.ts:164-195` does NOT expose port 4190
- **Webmail patch**: Expects port 4190 (`webmail-patch-configmap.ts:76-77`)
- **Impact**: ManageSieve functionality may be broken
- **Options**:
  1. Add port 4190 to dovecot service if ManageSieve supported
  2. Remove ManageSieve references if not supported
- **Action needed**: Test webmail Sieve functionality

### 6.2 Webmail Database Usage Unclear
- **Documentation**: Says webmail uses "shared PostgreSQL database as Admin"
- **Code**: Webmail has both PostgreSQL env vars AND /data PVC
- **Questions**:
  - Does webmail use PostgreSQL, SQLite, or both?
  - What is /data PVC used for?
  - Mailu documentation check needed
- **Action needed**: Clarify and document webmail storage model

### 6.3 Rate Limiting Value Discrepancy
- **Documentation**: Claims Traefik InFlightConn limit is 15
- **Code**: Postfix `smtpd_client_connection_count_limit` is 10
- **Questions**:
  - Is Traefik InFlightConn actually 15?
  - If so, which limit applies first?
- **Action needed**: Verify Traefik configuration, document both limits

---

## 7. IMPLEMENTATION PLAN

### Phase 1: Critical Port Documentation Fixes (HIGH PRIORITY)
**File**: `documentation/sources/reference/component-specifications.md`

**Changes**:
1. Line ~59: Change Admin port from 80 to 8080
2. Line ~96: Fix Postfix port 10025 description
3. Add Dovecot LMTP port 2525 to Dovecot section (~line 134)
4. Add Rspamd milter port 11332 to Rspamd section (~line 164)
5. Add complete port reference table at top of file

**Commit**: `docs: fix critical port documentation errors in component specs`

### Phase 2: Architecture Diagram Enhancements (HIGH PRIORITY)
**File**: `documentation/sources/explanation/architecture.md`

**Changes**:
1. Add port numbers to Mermaid diagram arrows
2. Add new section "Mail Delivery Flow Details" with sequences from section 5
3. Add prominent callout explaining FRONT_ADDRESS naming confusion
4. Fix rate limiting documentation (after verification)
5. Add service discovery section

**Commit**: `docs: enhance architecture diagram with ports and flows`

### Phase 3: New Documentation Pages (MEDIUM PRIORITY)
**Files to create**:
1. `documentation/sources/explanation/authentication-flows.md`
   - Nginx auth_http protocol
   - Webmail SSO authentication
   - Dovecot-submission trust model

2. `documentation/sources/explanation/nginx-configuration-patches.md`
   - TLS_FLAVOR=notls architecture
   - Each patch explained
   - Before/after examples

3. `documentation/sources/explanation/storage-architecture.md`
   - What each PVC stores
   - Backup strategies
   - Sizing guidelines

**File to modify**:
- `documentation/sources/index.md` - Add references to new pages

**Commit**: `docs: add authentication flows, nginx patches, and storage architecture`

### Phase 4: Code Fixes and Improvements (LOW PRIORITY)
**Files**:
1. `src/constructs/dovecot-construct.ts` - Add port 4190 or remove ManageSieve
2. `src/mailu-chart.ts` - Expand FRONT_ADDRESS comment
3. `src/constructs/admin-construct.ts` - Fix port 8080 comment
4. `documentation/sources/explanation/dovecot-submission.md` - Rewrite auth section

**Commit**: `fix: address ManageSieve port and clarify comments`

---

## 8. TESTING AND VALIDATION

### 8.1 After Phase 1
- [ ] Verify all port numbers match code references
- [ ] Build documentation: `cd documentation && make docs`
- [ ] Check for broken links

### 8.2 After Phase 2
- [ ] Verify Mermaid diagram renders correctly
- [ ] Verify all sequence flows are technically accurate
- [ ] Cross-check with code

### 8.3 After Phase 3
- [ ] Verify all new pages are linked from index
- [ ] Check navigation between related pages
- [ ] Verify all code references are correct
- [ ] Test documentation build

### 8.4 After Phase 4
- [ ] Test ManageSieve functionality if port added
- [ ] Verify mail flow works (send/receive via webmail)
- [ ] Check authentication (IMAP, SMTP, webmail)

---

## 9. SUMMARY

### Errors Found: 12
1. ✗ Admin service port (80 vs 8080) - **HIGH**
2. ✗ Postfix port 10025 description - **HIGH**
3. ✗ Missing Dovecot LMTP port 2525 - **MEDIUM**
4. ✗ Missing Rspamd milter port 11332 - **MEDIUM**
5. ✗ Architecture diagram missing port numbers - **LOW**
6. ✗ FRONT_ADDRESS naming confusion - **MEDIUM**
7. ✗ Dovecot-submission auth explanation misleading - **MEDIUM**
8. ✗ Missing nginx auth_http explanation - **MEDIUM**
9. ✗ Missing webmail SSO explanation - **LOW**
10. ✗ ManageSieve port in docs but not code - **MEDIUM** (bug?)
11. ✗ Webmail database usage unclear - **LOW**
12. ✗ Rate limiting value discrepancy - **LOW**

### Improvements Needed: 8
1. Add authentication flows documentation
2. Add nginx patches explanation
3. Add storage architecture details
4. Add complete port reference table
5. Add mail delivery flow diagrams
6. Document service discovery strategy
7. Clarify TLS_FLAVOR=notls implications
8. Add before/after patch examples

### Documentation Quality: GOOD (needs corrections and expansion)
**Strengths**: Good high-level architecture, excellent construct patterns
**Weaknesses**: Port numbers, authentication flows, technical details

---

## 10. STATUS TRACKING

- [x] Complete documentation analysis
- [ ] Phase 1: Fix critical port errors
- [ ] Phase 2: Enhance architecture diagrams
- [ ] Phase 3: Create new documentation pages
- [ ] Phase 4: Code fixes and improvements
- [ ] Testing and validation

**Next action**: Begin Phase 1 - Fix critical port documentation errors

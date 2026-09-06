# 12 — Security Hardening

## What this step is

Every milestone through 11 built a working system and was honest about what wasn't done yet. This one is different in kind: it's a security audit and hardening pass across the whole stack, done the way a principal security engineer coming from defense/critical-infrastructure work would do it - find the real, exploitable gaps by reading the actual code and running the actual containers, fix the ones that matter today, and write down exactly what's still missing rather than implying more coverage than exists.

Nothing here changes what the platform *does*. It changes what happens when someone tries to abuse it.

For the visual version of everything below: [`docs/00-overview.md`](00-overview.md) now has a third data-path diagram, **Path 3 — Auth and audit**, alongside the original control-plane and media-plane diagrams — see [`docs/images/security-and-audit-path.png`](images/security-and-audit-path.png), and the architecture-overview and command-path diagrams there were both updated (🔒 markers, the new rate-limit/audit-log steps) to show exactly what changed.

## Why it's needed

The audit that started this milestone read `auth/`, the MQTT ACL/broker config, `docker-compose.yml`, every Dockerfile, `nginx.conf`, and the frontend's token handling directly, rather than assuming milestones 1-11's own comments ("worth revisiting," "a later concern") had been revisited. They hadn't. Ranked by how bad it would have been if left alone:

1. **Redis had no password and its port was published to the host.** `redis:7-alpine` with no `requirepass`, `6379:6379` open. Session locks (`session:{robot_id}`) and live fleet state live entirely in Redis - anyone who could reach that port could read or overwrite them directly, bypassing the JWT layer, the session-ownership check, and the audit trail all at once. This was the worst finding: a complete authorization bypass requiring zero credentials.
2. **Postgres, Redis, and Mosquitto's host-published ports all bound to `0.0.0.0`** instead of loopback, for no operational reason - the robot and backend reach these by Docker service name on the internal network; the host-published ports exist only for local `psql`/`redis-cli`/`mosquitto_pub` debugging.
3. **`/auth/login` had no rate limiting.** The platform has exactly one shared operator credential (`docs/07-cloud-backend.md` was upfront about this being a placeholder) - an unlimited-attempt login endpoint against a single password is a brute-force invitation.
4. **CORS was `allow_origins=["*"]`.** Not a classic cookie-CSRF hole (auth is an explicit bearer token, not an ambient cookie), but a wildcard still let any origin that could get a request through read the response.
5. **JWTs could not be revoked.** No `/auth/logout`, no `jti`, no blacklist - a stolen token rode out its full lifetime (previously 1 hour) no matter what the operator did afterward.
6. **The JWT traveled in the WebSocket URL as `?token=`.** Browsers can't set custom headers on a WS handshake, so *something* has to go in the URL - but a long-lived credential in a URL can end up in access logs, proxy logs, or browser history. The project's own code comments already flagged this as worth revisiting.
7. **No durable, tamper-evident record of who commanded what.** Commands (including emergency stop) and session events were only ever `logger.info()`'d - readable, but neither durable across a log rotation/restart nor evidence against a deliberate edit.
8. **Containers ran as root**, with no Linux capabilities dropped anywhere.
9. **No security response headers anywhere** - not the API, not the frontend.
10. **No guard against booting with a shipped dev secret.** `JWT_SECRET=dev-only-insecure-secret-change-me` would boot silently in any environment, including a real deployment - a comment telling a human to change it is not a control.
11. **No backstop on the command channel.** Only the React frontend's own client-side 20 cmd/s throttle stood between an operator token and an unbounded flood of `robots/{id}/cmd` messages.

One thing the audit confirmed was *already* solid and needed no change: command payloads are a closed Pydantic `Literal["forward","backward","left","right","stop"]` - there's no injection surface in the command channel itself.

## What it does

### Redis authentication + network exposure
`docker-compose.yml`'s `redis` service now runs with `--requirepass` (`REDIS_PASSWORD`, wired through `app/config.py` → `app/db/redis.py`'s `create_client()`), and `redis`/`postgres`/`mosquitto`'s host-published ports are all bound to `127.0.0.1` instead of `0.0.0.0`. `redis-cli ping` from outside the container now gets `NOAUTH Authentication required.`

### CORS lockdown
`CORS_ALLOWED_ORIGINS` (default `http://localhost:3000`) replaces `allow_origins=["*"]` in `app/main.py`. A request with a disallowed `Origin` header no longer gets `Access-Control-Allow-Origin` echoed back.

### Login rate limiting + lockout
`app/auth/rate_limit.py`: a Redis-backed counter per client IP. 5 failed attempts within 5 minutes triggers a 5-minute lockout (`429` + `Retry-After`), wired into `POST /auth/login`. A correct password during a lockout still gets `429` - the lockout is on the endpoint, not just on wrong passwords, which is what actually stops a slow-brute-force script from ever getting a working password through.

### JWT revocation
Every token now carries a random `jti` claim (`app/auth/tokens.py`). `POST /auth/logout` (new) decodes the presented token and stores `revoked_jti:{jti}` in Redis with a TTL equal to the token's own remaining lifetime (`app/auth/revocation.py`) - so the blacklist entry never outlives the token it revokes and can't grow unbounded. `get_current_operator` checks this on every request. Default `JWT_EXPIRY_SECONDS` also dropped from 3600 to 1800.

### Short-lived, single-use WebSocket tickets
`POST /auth/ws-ticket` (bearer-authenticated) mints a `secrets.token_urlsafe(32)` ticket, stored in Redis for 15 seconds, consumed exactly once via an atomic `GETDEL`. Both `/ws/status` and `/ws/teleop/{id}` now take `?ticket=` instead of `?token=` - the frontend hooks (`useStatusSocket.ts`, `useTeleopSocket.ts`) fetch a fresh ticket immediately before every connection attempt, including reconnects. Verified directly: a ticket used twice gets rejected with `HTTP 403` on the second attempt.

### Tamper-evident audit log
A new `audit_log` table (hash-chained: `entry_hash = sha256(prev_hash + canonical_json(row))`, appends serialized with a Postgres advisory lock) records every login attempt, logout, session acquire/release, and command - including `stop` - with actor, result, and detail. `scripts/verify-audit-log.py` walks the chain and reports the first broken link. Writes are best-effort (`record_safe()`): an audit-log failure logs loudly but never blocks the real action, since an emergency stop must still reach the robot even if Postgres is briefly unreachable.

### Startup guard against insecure defaults
`assert_production_safe()` in `app/config.py`, called from `main.py` at import time: if `ENVIRONMENT=production` and any of `jwt_secret`/`operator_password`/`mqtt_backend_password`/`postgres_password`/`redis_password` still equal their known dev-default value, the process raises `RuntimeError` and refuses to start. `ENVIRONMENT=development` (the default) preserves `docker compose up`'s zero-config experience exactly as before.

### Security headers
`app/security_headers.py`'s `SecurityHeadersMiddleware` adds `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a `default-src 'none'` CSP, and `Cache-Control: no-store` on `/auth/*`. `nginx.conf` (frontend prod target) adds the same category of headers plus a CSP scoped for a WebRTC/WebSocket SPA (`connect-src` stays broad - `ws:`/`wss:`/`http:`/`https:` - because the real backend/TURN origins are only known at container start via the existing runtime-config-injection mechanism, not at the time this static config file is written; pinning them exactly would mean templating this file too, noted as follow-up below).

### Command-channel backstop rate limit
`app/fleet/rate_limit.py`: a Redis fixed-window counter per `(operator, robot_id)`, capped at 40 commands/second - double the frontend's own 20/s client-side throttle, so it never interferes with normal teleop and only catches a genuine flood. **`stop` is explicitly exempt** - a safety override that could itself be rate-limited out of delivery (e.g. by the very flood of movement commands it's meant to interrupt) would defeat its own purpose.

### Container hardening
`backend.Dockerfile` now creates and runs as a non-root `appuser` (uid 1000) - verified live (`docker exec ... whoami` → `appuser`). `docker-compose.yml` adds `security_opt: [no-new-privileges:true]` to every service, and `cap_drop: [ALL]` additionally to `backend` and `frontend` (images this project controls, with no special syscall needs). Deliberately **not** applied to `mosquitto`/`postgres`/`redis`/`coturn`/`robot` - see Next steps.

### Dependency audit
`pip-audit` found real, fixable CVEs in `PyJWT==2.9.0` and (transitively, via `fastapi==0.115.0`) `starlette==0.38.6`. Fixed by bumping to `PyJWT==2.13.0` and `fastapi==0.141.1` (which pulls a patched `starlette==1.6.0`) - re-audited clean, and the full backend unit test suite (35 tests) plus a live rebuild were used to confirm the major-version bumps didn't break anything. `npm audit fix` (no `--force`) cleared a moderate `esbuild`/`vite` finding in the main frontend with a lockfile-only patch bump; `robostore-poc` was already clean. One moderate `react-router` finding (open-redirect edge case) remains - see Next steps for why it wasn't force-fixed blindly. `make security-audit` wraps all four checks for repeat use.

### Secrets hygiene
`scripts/generate-secrets.sh` prints strong (`openssl rand`) values for every credential this project reads from `.env`, for anyone deploying this outside pure local dev. `.env` was already correctly gitignored.

## Verification

Every claim above was checked against the live stack, not just written down:

- `docker compose up -d mosquitto redis postgres backend` → all four report healthy; `docker exec cloud-robotics-redis redis-cli ping` → `NOAUTH`; with `-a $REDIS_PASSWORD` → `PONG`.
- Full login → 401/429 lockout sequence exercised with `curl`: 5 wrong passwords lock out the 6th attempt (including a *correct* password) for 300s.
- Login → authenticated `GET /robots` (200) → `POST /auth/logout` (204) → same token reused (401 "Token has been revoked") → fresh login works again.
- A real WebSocket client (Python `websockets`) proved a ws-ticket is genuinely single-use: first connection succeeds, immediate reuse of the same ticket gets `HTTP 403`.
- `scripts/verify-audit-log.py` reported a clean chain after generating real activity, then correctly detected and pinpointed a manually corrupted row (`UPDATE audit_log SET result = 'success-fake' WHERE id = 6`) after the fact.
- `assert_production_safe()` unit-verified directly: raises with dev defaults + `ENVIRONMENT=production`, passes with real secrets, and is a no-op under the default `ENVIRONMENT=development`.
- `backend.Dockerfile` rebuilt and brought up live; `docker exec cloud-robotics-backend id` → `uid=1000(appuser)`, not root.
- The full backend unit suite (`test_auth.py`, `test_fleet_manager.py`, `test_mqtt_acl.py`, `test_webrtc_relay.py`, `test_registry_and_sessions_live.py`) passes against both the pre- and post-dependency-upgrade environments.
- The frontend prod target was built and run standalone; response headers confirmed via `curl -D -`. `tsc --noEmit && vite build` (the same command the Dockerfile runs) succeeds with the WS-ticket hook changes in place.

Not run in this pass: the full Gazebo/robot-container path and the browser-driven Playwright E2E suite (`make test`) - both are heavy (the robot container alone needs several minutes and a real X11/GPU-adjacent setup) and nothing changed in this milestone touches ROS2, GStreamer, or WebRTC media negotiation. Recommended before treating this as fully regression-tested: `make test` end to end.

## Next steps

Deliberately left for whoever picks this up next - not forgotten, and not silently implied to be covered by the work above:

- **MQTT transport security.** The broker (`mosquitto`) still speaks plaintext MQTT on the internal Docker network; credentials are still per-role passwords, not certificates. A real deployment should add TLS (and ideally mutual TLS) between the Robot Cloud Agent and the broker, which is also exactly the shape AWS IoT Core's certificate-based auth expects - see `docs/11-aws-migration.md`.
- **Real per-operator accounts.** Still one shared credential. A users table with hashed passwords (argon2/bcrypt), roles, and per-operator audit attribution (the audit log already records *whichever* username authenticated - it's ready for this) is the natural next step, as `docs/07-cloud-backend.md` already noted. MFA/WebAuthn belongs here too.
- **Secrets manager.** Credentials still live in `.env`/environment variables. Vault or AWS Secrets Manager (per the migration guide) removes them from disk and adds rotation.
- **CI security gates.** `make security-audit` exists but nothing runs it automatically - no SAST, dependency scanning, or container image scanning (e.g. Trivy) is wired into a pipeline, because no CI pipeline exists yet at all (`docs/11-aws-migration.md`'s own Next steps already noted this gap).
- **Centralized, immutable log shipping.** The audit log's hash chain proves tampering *after the fact*, from a snapshot of one Postgres table. A real deployment should also ship it to write-once storage (e.g. via a WAL-tailing pipeline) so an attacker with a live database connection and enough patience can't rewrite the whole chain from some point forward and pass `verify-audit-log.py` anyway.
- **Full capability-drop hardening for `mosquitto`/`postgres`/`redis`/`coturn`/`robot`.** Only `no-new-privileges` was added to these - `cap_drop: [ALL]` was deliberately not attempted because their entrypoints (Mosquitto's password-file generation, coturn's host-networked UDP relay, Gazebo/GStreamer/X11 in the robot container) have privilege needs this pass didn't have room to map and test exhaustively without risking a hard-to-debug break in the heaviest, slowest-to-iterate-on container in the project.
- **`react-router` open-redirect fix.** `npm audit` flagged a moderate-severity issue fixed only in a major version bump (`react-router-dom` 6.x → 7.18.3). Not forced in this pass since a major router version bump needs real navigation regression testing this pass didn't budget for - do it as its own change, with the app exercised end to end afterward.
- **Precise CSP `connect-src`.** The frontend's CSP currently allows any `ws:`/`wss:`/`http:`/`https:` origin rather than the exact configured backend/TURN addresses, because those are only known at container start. Templating `nginx.conf` through the same `envsubst` mechanism `config.json` already uses would close this.
- **A real third-party penetration test** before any operational (non-simulation) deployment - everything above is a genuine hardening pass, not a substitute for independent adversarial review.

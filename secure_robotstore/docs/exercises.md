# The exercises, one at a time

The README's task table is the index. This is the detail behind it: for each
of the twelve holes, what is actually wrong, how to *prove* it is wrong
before touching anything, what "fixed" means, and how to prove it is fixed
afterwards.

Work in this order. Each step assumes the ones before it.

## Before you start

Get the stack running first — no Docker needed. The setup is in
[`../README.md`](../README.md#run-it): install five programs, create the database,
then start four terminals (broker, backend, agent, frontend). Every command below
assumes those are up, with the broker on `localhost:1884`, Postgres on `5433` and
Redis on `6380`. Those sit one above the main cloud-robotics platform's ports so
both can run at once.

## How to work on these

**Prove the hole first.** Every task below starts with a command that
demonstrates the problem against the running stack. Run it. A fix you
cannot see working is a fix you cannot trust — and several of these holes
are invisible from the UI, which is the point of them.

**Keep the app working.** After every change:

```bash
# restart whichever terminal you changed — broker, backend or agent
curl -s localhost:8001/health/detail | python3 -m json.tool
open http://localhost:3001               # both windows should still tick at 1 Hz
```

A security change that silently stops the data flowing is not a pass. The
most common way to fail these is to lock out the *legitimate* clients along
with the attacker — the agent and the backend are MQTT clients too.

**The reference implementations are real, not sketches.** Every "compare
against" path below exists in this repo and runs in the main stack. Read
them *after* your own attempt, not before: the point is to arrive at the
reasoning, and the comparison is the check on it.

**One caveat on the comparisons.** The main stack solves these at fleet
scale — many robots, per-robot MQTT identities, JWT revocation, hash-chained
audit. This demo has one device and two data types. Match the *reasoning*,
not the line count. Where the reference is more elaborate than this demo
needs, the file's own docstring usually says why.

---

## 1. MQTT authentication

**What's wrong.** `mosquitto/mosquitto.conf` sets `allow_anonymous true`.
Any client that can open a TCP connection to the broker is a trusted client.
There are no credentials anywhere in this stack to check.

**Prove it.**

```bash
mosquitto_pub -h localhost -p 1884 -t devices/demo-device-01/int \
  -m '{"value":999,"seq":999999}'

psql -h localhost -p 5433 -U robotstore -d robotstore \
  -c "SELECT * FROM int_readings WHERE seq = 999999;"
```

No credential was offered, and the forged reading is now permanently in the
system of record.

**Done looks like.** `allow_anonymous false` plus a `password_file`, with
two separate identities — one for the agent, one for the backend. Both
clients call `username_pw_set()` before `connect_async()`; there are marked
`INTERN TASK` comments at exactly the right spot in
`robot-agent/agent/mqtt_client.py` and `cloud/backend/app/mqtt/service.py`.

The passwords come from the environment, not from a committed file. Note
what the real stack does here and why: `cloud-container/mosquitto/docker-entrypoint-wrapper.sh`
generates the password file at container start from env vars, so the
plaintext never exists in git.

**Verify.** The anonymous publish above is now refused, and
`/health/detail` still reports `mqtt.connected: true` for the backend while
`localhost:8081` still reports `mqtt_connected: true` for the agent.

> Watch for: paho's `connect_async` retries forever in the background. If
> you get the credentials wrong, nothing crashes — the data just stops, and
> the broker log is the only place that says why. `make logs` is your
> friend.

**Compare against.** `cloud-container/mosquitto/mosquitto.conf`,
`cloud-container/mosquitto/docker-entrypoint-wrapper.sh`.

---

## 2. MQTT topic ACLs

**What's wrong.** Authentication alone only proves *who* a client is. With
no `acl_file`, every authenticated client may still publish and subscribe to
everything — so a compromised backend can forge device telemetry, and
anything holding the agent's credential can publish commands back to the
device.

**Prove it.** With task 1 done, connect as the *backend* identity and
publish a device reading. It succeeds. It should not: the backend has no
business claiming to be a device.

```bash
mosquitto_pub -h localhost -p 1884 -u backend -P "$MQTT_BACKEND_PASSWORD" \
  -t devices/demo-device-01/string -m '{"value":"forged","seq":1}'
```

**Done looks like.** An `acl_file` that splits the directions:

- the device may **write** `devices/{id}/string` and `devices/{id}/int`, and
  **read** `devices/{id}/cmd`
- the backend may **read** the telemetry topics and **write** `devices/+/cmd`

That asymmetry is the whole exercise. Telemetry is a device self-report, so
nothing else should be able to author it; commands originate in the cloud,
so the device only ever reads them. `cmd_topic()` already exists in both
topic modules for exactly this reason, even though no UI sends a command yet.

**Verify.** The forged publish above is refused, real telemetry still flows,
and the agent still logs a received command when you publish one as the
backend identity.

**Compare against.** `cloud-container/mosquitto/aclfile` — and read its
comments on `pattern` and `%u`. Using the robot's id *as* its MQTT username
means onboarding a new device is issuing a credential, not editing the ACL
file. That trick is worth stealing.

---

## 3. Real credential checking

**What's wrong.** `cloud/backend/app/api/auth.py` holds a dict of plaintext
passwords in source, compares them with `==`, and returns a different error
for "no such user" than for "wrong password".

**Prove it.**

```bash
curl -s -X POST localhost:8001/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"operator","password":"wrong"}'    # -> "Wrong password."
curl -s -X POST localhost:8001/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"nobody","password":"wrong"}'      # -> "No such user."
```

Two different answers. An attacker now enumerates valid usernames for free,
before trying a single password against them.

**Done looks like.** One generic failure message for both cases, and a
constant-time comparison (`hmac.compare_digest`, not `==`) so response
*timing* does not leak the same thing the message used to.

**A note on where the credentials live.** The README's table says "users in
Postgres, hashed". That is the right destination, but be aware the reference
file does not go that far: `auth/service.py` checks one operator credential
supplied by config, and says in its own docstring that a users table with
hashed passwords is a natural extension of that one function. Either target
is a legitimate answer to this exercise. If you do store users, hash with
bcrypt or argon2 — never a bare SHA.

**Verify.** Both failing requests above return byte-identical responses. A
correct login still works, and the frontend still signs in.

**Compare against.** `cloud-container/backend/app/auth/service.py`.

---

## 4. Real tokens

**What's wrong.** The token is `base64(username + ":demo")`. It is not
signed, so anyone can mint one, and it carries no expiry, so it is valid
forever.

**Prove it.**

```bash
python3 -c "import base64; print(base64.b64encode(b'operator:demo').decode())"
```

That is the exact string the server issues. You just minted an admin
session without touching the server.

**Done looks like.** A signed JWT with `sub`, `iat` and `exp` claims, signed
with a secret from the environment. Decoding and verifying happens
server-side; the secret never reaches the browser.

**Verify.** A token with a tampered payload is rejected. A token past its
`exp` is rejected. (You cannot verify either until task 5 gives you an
endpoint that actually checks — do 4 and 5 together and test at the end of
5 if you prefer.)

**Compare against.** `cloud-container/backend/app/auth/tokens.py`. Note the
`jti` claim: a JWT is stateless and so cannot be invalidated before it
expires, and `jti` is the handle a Redis blacklist keys on at logout. That
is a genuinely optional extra here — but understanding *why* stateless
tokens need it is not.

---

## 5. Protect the endpoints

**What's wrong.** Nothing checks the token. Every REST route in
`api/data.py` and both WebSockets in `ws/stream.py` serve anyone. The route
guard in `App.tsx` hides the UI and protects nothing.

**This is the one that matters most.** Tasks 3 and 4 are worth nothing on
their own — a perfect token nobody validates is still a perfect token nobody
validates.

**Prove it.**

```bash
curl -s -o /dev/null -w "history -> %{http_code}\n" localhost:8001/api/string/history

python3 - <<'PY'
import asyncio, websockets
async def main():
    async with websockets.connect("ws://localhost:8001/ws/int_api") as ws:
        print("connected with no token:", (await ws.recv())[:60])
asyncio.run(main())
PY
```

Both succeed, signed out, from outside the browser entirely.

**Done looks like.** A FastAPI dependency on every REST route, and a check
on both WebSocket upgrades before `accept()`.

The WebSocket half is the interesting one. Browsers cannot set custom
headers on a WebSocket handshake, so `Authorization: Bearer` is not
available to you — something has to travel in the URL. A token in a query
string ends up in proxy logs and access logs, which is why the reference
implementation issues a short-lived single-use *ticket* instead: 15 seconds,
consumed on first use (`GETDEL`), so a captured one is already spent.

Then finish the client side: attach `Authorization: Bearer` in
`src/api/client.ts` (there is a marked comment where it goes) and fetch a
ticket before opening each socket in `useReadingSocket.ts`.

**Verify.** Both commands above now fail without a token and succeed with
one. The browser still works end to end — log in, both windows tick.

**Compare against.** `cloud-container/backend/app/auth/dependencies.py`.

---

## 6. Login rate limiting

**What's wrong.** `/auth/login` can be tried as fast as the network allows.

**Prove it.**

```bash
time for i in $(seq 1 200); do
  curl -s -o /dev/null -X POST localhost:8001/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"operator","password":"guess'"$i"'"}'
done
```

Two hundred attempts, no resistance, no trace.

**Done looks like.** A Redis-backed failure counter keyed on client IP: N
failures inside a window triggers a lockout with its own TTL, and a
successful login clears both keys.

**Verify.** The loop above starts returning lockout responses partway
through. A correct password during the lockout is *also* refused — that is
correct behaviour, not a bug. After the TTL expires, login works again.

**Compare against.** `cloud-container/backend/app/auth/rate_limit.py`. Read
its docstring on why a fixed window is the right amount of machinery here:
this is one account being guessed at, not traffic shaping across millions.

---

## 7. Input size limits

**What's wrong.** Two places accept unbounded input. `mqtt/service.py`
calls `json.loads()` on whatever arrives with no size check, and
`store.py` writes a string reading of any length to Postgres, Redis, and
every open browser. `mosquitto.conf` sets no `message_size_limit` either.

**Prove it.**

```bash
python3 -c "print('{\"value\":\"' + 'A'*5000000 + '\",\"seq\":424242}')" > /tmp/huge.json
mosquitto_pub -h localhost -p 1884 -t devices/demo-device-01/string -f /tmp/huge.json
```

Watch the UI while that lands. The parse runs on the single event loop that
serves every WebSocket client, so one oversized message stalls *everyone* —
and the 5 MB string is now a permanent Postgres row.

**Done looks like.** Defence at all three layers, because each catches what
the others cannot: `message_size_limit` at the broker (cheapest — rejects
before the backend ever sees it), a length check before `json.loads()` in
the MQTT service, and a value-length cap in `ReadingStore.record()` for
payloads that are small but still wrong.

**Verify.** The oversized publish is rejected, no giant row appears in
Postgres, and normal readings keep flowing throughout.

**Compare against.** `cloud-container/backend/app/mqtt/service.py`, and the
`message_size_limit` block in `cloud-container/mosquitto/mosquitto.conf` —
whose comment works out the limit from the largest *legitimate* message
rather than picking a round number.

---

## 8. CORS and security headers

**What's wrong.** `CORS_ALLOWED_ORIGINS` is `"*"`, so any site a signed-in
user visits can call this API from their browser. And neither the API nor
nginx sets a single security header.

**Prove it.**

```bash
curl -sI localhost:8001/health | grep -iE 'x-frame|x-content|content-security|referrer' \
  || echo "no security headers at all"
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://evil.example" localhost:8001/api/int/latest
```

**Done looks like.** An explicit origin allowlist read from the env var
(`http://localhost:3001` here), and headers on both sides — middleware on
the API, `add_header` directives in `cloud/frontend/nginx.conf`.

Know what each header actually stops before adding it. `X-Frame-Options:
DENY` and `frame-ancestors 'none'` stop clickjacking; `nosniff` stops
content-type confusion; CSP limits what the page may load. Adding five
headers you cannot explain is cargo cult, not security.

**Verify.** The `evil.example` origin is refused; `http://localhost:3001`
still works and the UI is unaffected. Headers appear on both
`localhost:8001` and `localhost:3001` responses.

**Compare against.** `cloud-container/backend/app/security_headers.py` and
`cloud-container/frontend/nginx.conf`.

---

## 9. TLS

**What's wrong.** Every hop is plaintext: MQTT on 1884, Postgres, Redis, and
HTTP at the edge. Task 2's `mosquitto_sub` proved the broker half — anyone
on the network path reads all telemetry, and with task 1 done they can still
read the *credentials* off the wire on connect.

**Done looks like.** A TLS listener on 8883 with certificates, `tls_set()`
on both clients, TLS to Postgres and Redis, and HTTPS at the edge.

**The one mechanical trap.** paho applies TLS when the socket is created, so
`tls_set()` must be called *before* `connect_async()`. Call it after and it
silently does nothing — you get a plaintext connection that looks fine. The
`INTERN TASK` comments in both MQTT client files sit deliberately above the
constructor for this reason.

**Verify.** `mosquitto_sub` against the plaintext port no longer sees
traffic; the same subscribe over TLS with the CA cert does.

**Compare against.** `scripts/generate-dev-certs.sh`, and the `mqtt_tls_*`
settings in `cloud-container/backend/app/config.py` — note they exist and
default to off, so enabling transport security is a deployment change rather
than a code change.

---

## 10. Service hardening

**What's wrong.** Everything you started runs as *you* — your own login
account, with access to every file you own. Redis and Postgres were
installed with their defaults, no memory limit is set anywhere, and the
broker binds every network interface rather than just loopback — so the
broker, Postgres and Redis are reachable from anything that can route to
this machine.

**Prove it.**

```bash
whoami                                 # the backend runs as this account
ss -tlnp | grep -E '1884|5433|6380'    # bound on 0.0.0.0, not 127.0.0.1
```

From another machine on the same network, `psql -h <this-host> -p 5433 -U
robotstore -d robotstore` reaches your database.

**Done looks like.** A dedicated non-root user per service — not your own
login, which owns the source. Loopback-only bindings for the broker, Redis
and Postgres (`bind 127.0.0.1` in `redis.conf`, `listen_addresses = 'localhost'`
in `postgresql.conf`, `listener 1884 127.0.0.1` in the broker config). A
memory limit per service. Config files holding credentials readable only by
their owner. Only the frontend and the backend API have any reason to be
reachable from elsewhere.

**Verify.** The ports show `127.0.0.1`, each service runs as its own user,
and the stack still comes up clean. Watch for permission errors after the
switch — that is the usual breakage, and widening the permission again is
not the fix.

**The same idea, containerised.** The real stack solves this with non-root
`USER` directives, `no-new-privileges` and loopback-only port publishing —
see the root `docker-compose.yml` and
`cloud-container/docker/backend.Dockerfile`. The principles are identical;
only the mechanism differs.

---

## 11. Secrets

**What's wrong.** `.env` and `.env.example` are identical, and both contain
`POSTGRES_PASSWORD=robotstore`. `local.env` reuses those defaults
inline. Every deployment of this demo has the same credentials as every
other one.

**Done looks like.** A generator script that produces per-environment
secrets, an `.env.example` that documents the *names* with no working
values, and a startup guard that refuses to run with a default secret when
the environment claims to be production.

That last part is the one people skip. A default credential that only fails
at code-review time will eventually reach production; one that refuses to
boot cannot.

**Verify.** A fresh checkout cannot start without generating secrets first,
and the guard rejects a production start carrying a known-default value.

**Compare against.** `scripts/generate-secrets.sh`, and
`assert_production_safe()` with its `_INSECURE_DEFAULTS` set in
`cloud-container/backend/app/config.py`.

---

## 12. Audit logging

**What's wrong.** Auth events reach `logger.info()` and nothing else. That
is neither durable (log rotation, a restarted container) nor tamper-evident
— anyone with disk access edits it leaving no trace.

For a system that drives physical hardware, "who commanded what, when" has
to survive an incident review.

**Done looks like.** An append-only Postgres table recording every auth
event and every command, hash-chained so that
`entry_hash = sha256(prev_hash + canonical_json(row))`. Editing or deleting
any row breaks every hash after it, so recomputing the chain detects
tampering without needing signatures or external log shipping.

**Verify.** Log in, log out, fail a login; all three appear. Then edit a row
directly with `psql` and confirm your verification pass detects the break.

**Compare against.** `cloud-container/backend/app/audit/logger.py`. Two
details there are worth the read: canonical JSON with `sort_keys=True`
(because dict ordering would otherwise change the hash of identical data),
and the Postgres advisory lock around appends — without it two concurrent
writers can read the same `prev_hash` and both chain legitimately from it,
which row insertion order alone does not prevent.

---

## When you're done

Re-run the three headline checks one final time:

```bash
make verify-holes
```

All three should now fail to demonstrate anything — the anonymous publish
refused, the subscribe refused, the unauthenticated API read a 401 — while
the browser at `http://localhost:3001` still shows both windows ticking once
a second.

That combination is the actual pass condition. Either half alone is easy.

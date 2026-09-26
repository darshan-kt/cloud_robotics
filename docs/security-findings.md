# Security Findings — Second-Pass Audit

**What this is.** A second security review of the *existing* code, architecture, functionality, and development workflow — deliberately covering the areas the first hardening pass ([`docs/12-security-hardening.md`](12-security-hardening.md)) did **not** examine: the robot container, the WebRTC signalling path, the broker's resource limits, the second frontend, and the developer workflow itself.

**Method.** Every finding is traced to a specific file and line and was confirmed by reading the code, not inferred from documentation. Findings the audit *cleared* are listed too (§4) — a security review that only reports problems tells you nothing about coverage.

**Headline.** The first pass fixed the acute perimeter problems and those fixes hold. This pass found **four issues that pass rated high or critical**, all in code the first pass never opened. The most serious is a one-line omission from that first pass, which is noted plainly below rather than quietly fixed.

---

## 1. Severity summary

| # | Finding | Severity | Status |
|---|---|---|---|
| **F1** | Robot health/metrics endpoint is unauthenticated and published on `0.0.0.0` — leaks the robot's MQTT username | **Critical** | ✅ **Fixed & verified** |
| **F2** | MQTT broker has no message-size, connection, or queue limits — trivial fleet-wide DoS | **High** | ✅ **Fixed & verified** |
| **F3** | WebRTC offer endpoint has no rate limit, and every offer destroys the live video session | **High** | ✅ **Fixed & verified** |
| **F4** | SDP is unbounded and unvalidated, then fed to a C library on the robot | **High** | ✅ **Fixed & verified** |
| **F5** | Robot container runs as root and mounts the host X11 socket read-write | **Medium** | ✅ **Fixed** (Gazebo runtime unverified — see note) |
| **F6** | Robot MQTT has no TLS support *in code* — enabling it is a code change, not config | **Medium** | ✅ **Fixed & verified** |
| **F7** | `robot_id` doubles as the MQTT username and as a public identifier | **Medium** | ✅ **Risk removed** (see note) |
| **F8** | ROBOSTORE stores app data unencrypted in the browser with a stub auth gate | **Low** | ⬜ Documented, no change needed |
| **F9** | Login rate limiter made the live test suite non-idempotent *(found while fixing the above)* | **Medium** | ✅ **Fixed & verified** |
| **F10** | Mosquitto warns it will refuse to load the password/ACL files on a future version *(found in broker logs)* | **Medium** | ✅ **Fixed & verified** |
| **F11** | `MQTT_PORT` conflated the client-connect port with the host-published port *(found enabling TLS)* | **Low** | ✅ **Fixed & verified** |

**Remediation status: all findings addressed.** F1–F7 and F9–F11 are fixed and verified against the live stack; F8 needed documentation rather than code. The suite now stands at **72 cloud + 51 robot tests passing**, with **39 new regression tests** added across this work.

**Three findings were discovered while fixing the others** and are recorded rather than quietly patched — F9 (self-inflicted by the earlier hardening pass), F10 (spotted in broker logs while verifying F7), and F11 (hit while enabling TLS end to end). Each is written up in full below, because how a problem was found is often more useful to the next reader than the fix itself.

---

## 2. Findings in detail

### F1 — Unauthenticated robot health/metrics, published to every interface

**Severity: Critical** · [`robot_agent/health_server.py:59`](../robot-container/robot_agent/health_server.py#L59), [`docker-compose.yml`](../docker-compose.yml)

The robot's HTTP server binds `("0.0.0.0", port)` and has **no authentication of any kind** — `do_GET` serves `/health` and `/metrics` to anyone who asks. Compose then publishes it to every host interface:

```yaml
ports:
  - "${ROBOT_HEALTH_PORT:-8080}:8080"     # ← not loopback-bound
```

**This is an omission from the first hardening pass.** That pass rebound `redis`, `postgres`, and `mosquitto` to `127.0.0.1` and did not apply the same treatment here. The fix belonged in that change and was missed.

**Why it matters more than a typical metrics leak.** The response includes `robot_id` — and `robot_id` **is the robot's MQTT username** ([`docker-entrypoint-wrapper.sh:26`](../cloud-container/mosquitto/docker-entrypoint-wrapper.sh#L26), and the ACL's `%u` pattern depends on it). So an unauthenticated request returns half of a valid credential pair. Combined with the single shared `MQTT_ROBOT_PASSWORD` across the fleet, an attacker on the campus network gets: the robot's identity, whether it is connected, whether commands are flowing (`commands_received`, `commands_rejected`), and whether anyone is watching video (`webrtc_offers_handled`). That is target selection and timing.

**Fix, step 1 — immediate (compose):**

```yaml
ports:
  - "127.0.0.1:${ROBOT_HEALTH_PORT:-8080}:8080"
```

`make health` still works, and Docker's own `HEALTHCHECK` is unaffected because it runs inside the container.

**Fix, step 2 — required for real robots.** On actual hardware the agent is on the campus LAN, so loopback publishing does not apply and the endpoint needs its own auth. Add a shared-secret check:

```python
# health_server.py
def do_GET(self) -> None:
    if self.server.auth_token:
        provided = self.headers.get("Authorization", "")
        expected = f"Bearer {self.server.auth_token}"
        if not hmac.compare_digest(provided, expected):
            self._respond(401, {"error": "unauthorized"})
            return
    ...
```

Keep `/health` (liveness only — `{"status":"ok"}`) unauthenticated so orchestrator probes work, and put the detailed payload behind the token on `/metrics`.

**Verify:** `curl http://<robot-ip>:8080/metrics` from another machine must fail.

#### ✅ Fixed

Both steps shipped, plus one change the finding did not anticipate:

- Port is now published as `127.0.0.1:${ROBOT_HEALTH_PORT}:8080`.
- `/metrics` and a new `/status` require `Authorization: Bearer $ROBOT_HEALTH_TOKEN` when that variable is set, compared with `hmac.compare_digest`.
- **`/health` was narrowed to bare liveness** (`{"status": "ok"}`). It stays unauthenticated so orchestrator probes keep working — but it no longer returns `robot_id` or `mqtt_connected`, because the one endpoint that must stay open is exactly the one that must not carry identity. The full payload moved to the protected `/status`.
- No token configured leaves the endpoints open, preserving zero-config local development; the agent logs `UNAUTHENTICATED (set ROBOT_HEALTH_TOKEN)` at startup so it is never silently forgotten.
- `make health` still works; new `make robot-status` fetches the protected payloads.

**Verified:** 10 tests in [`robot-container/tests/test_health_server.py`](../robot-container/tests/test_health_server.py) driving a real HTTP server, including `test_health_never_leaks_robot_id_even_when_open`. Config wiring confirmed live — `ROBOT_HEALTH_TOKEN` reaches `HealthServerConfig.auth_token`, and an unset token still yields the open path.

---

### F2 — Broker has no resource limits: trivial fleet-wide denial of service

**Severity: High** · [`cloud-container/mosquitto/mosquitto.conf`](../cloud-container/mosquitto/mosquitto.conf)

The config sets authentication and ACLs correctly but **no resource limits at all**. Mosquitto's `message_size_limit` defaults to `0`, meaning unlimited.

**Attack path, end to end:** any client holding a valid credential — and every robot in the fleet shares one password — publishes a single enormous payload to its own permitted topic. The broker accepts it. The backend's paho thread decodes it and calls `json.loads` on the **single asyncio event loop** ([`mqtt/service.py:146-162`](../cloud-container/backend/app/mqtt/service.py#L146-L162)). One multi-hundred-megabyte payload stalls or kills the process that serves *every* robot and *every* dashboard. There is no per-client quota to contain it, and no `max_connections` to stop connection exhaustion either.

**Fix — append to `mosquitto.conf`:**

```conf
# Resource limits. A robot's largest legitimate message is a LiDAR scan
# (~8 KB) or an SDP offer (~6 KB); 256 KB is generous headroom. Without
# this, message_size_limit defaults to 0 (unlimited) and one client can
# stall the backend's single event loop for the whole fleet.
message_size_limit 262144
max_connections 200
max_queued_messages 1000
max_inflight_messages 20
max_keepalive 120
```

**Defence in depth — also cap it backend-side**, since the broker is not the only possible publisher:

```python
# mqtt/service.py, in _handle_message before json.loads
MAX_PAYLOAD_BYTES = 262_144
if len(msg.payload) > MAX_PAYLOAD_BYTES:
    self._logger.error(f"Oversized payload on {msg.topic}: {len(msg.payload)} bytes - dropped")
    return
```

**Verify:** publish a 1 MB payload with `mosquitto_pub`; the broker must reject it and the backend must stay healthy.

#### ✅ Fixed

All five broker limits added to `mosquitto.conf`, plus the backend-side `MAX_PAYLOAD_BYTES` guard placed **before** `json.loads` in `_handle_message`.

**Verified live, by delivery rather than by exit code** — which matters, because `mosquitto_pub` returns 0 even when the broker drops the message. With a subscriber attached, a 1 MB publish followed by a normal one produced exactly one delivered message of 25 bytes (`{"battery_percentage":87}`): the oversized message never reached the subscriber, the normal one did, and the backend stayed healthy throughout.

Also covered by 4 tests in [`cloud-container/tests/test_input_limits.py`](../cloud-container/tests/test_input_limits.py), including a boundary case at exactly the limit and `test_the_ceiling_is_bounded_and_sane` — which stops someone "fixing" a future rejection by raising the ceiling back into DoS territory.

---

### F3 — WebRTC offers are unlimited, and each one kills the live video session

**Severity: High** · [`api/webrtc.py`](../cloud-container/backend/app/api/webrtc.py), [`video_streamer.py:265`](../robot-container/robot_agent/video_streamer.py#L265)

Two facts that are individually reasonable and jointly a problem:

1. `POST /robots/{id}/webrtc/offer` has **no rate limiting**. The first hardening pass added a backstop limiter to `FleetManager.send_command()` only; this endpoint bypasses it entirely.
2. `_prepare_fresh_webrtcbin()` builds a **brand-new `webrtcbin` for every offer, discarding the previous one** — a deliberate, correct fix for a real reconnect bug, documented in `docs/06-video-streaming.md`.

**Consequences:**

- **Any authenticated operator can terminate any other operator's live video** on a shared robot simply by requesting video themselves. No lock, no warning. In a classroom, one student can black out the instructor's feed.
- Repeated offers rebuild the GStreamer pipeline in a loop — **CPU denial of service on the robot itself**, the least powerful machine in the system.
- Each offer holds an `asyncio.Future` for up to 20 seconds ([`relay.py:36`](../cloud-container/backend/app/webrtc/relay.py#L36)). Spamming offers accumulates pending futures and in-flight MQTT publishes.
- It repeatedly exercises the GStreamer pad-unlinking race that the LiDAR work **narrowed but did not prove closed under adversarial load** — it was validated at 16 reconnects, not 16,000.

**Fix — reuse the existing limiter pattern rather than inventing a second one:**

```python
# app/webrtc/rate_limit.py  — mirrors app/fleet/rate_limit.py
_MAX_OFFERS_PER_WINDOW = 5
_WINDOW_SECONDS = 60

async def check_offer_allowed(redis_client, operator: str, robot_id: str) -> None:
    key = f"webrtcrate:{operator}:{robot_id}"
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, _WINDOW_SECONDS)
    if count > _MAX_OFFERS_PER_WINDOW:
        raise OfferRateLimitError(...)   # -> HTTP 429
```

Five renegotiations per minute is far above normal use (a healthy session negotiates once) and far below what is needed to disrupt anything.

**Also add a viewer lock**, so the "last offer wins" behaviour becomes explicit rather than a surprise: track the current video holder in Redis, and either reject a second viewer with `409 Conflict` or require an explicit takeover — the same pattern `SessionManager` already implements for teleop control.

**Verify:** issue 10 offers in a loop; expect `429` from the sixth. With two browsers on one robot, confirm the second gets a clear conflict rather than silently killing the first.

#### ✅ Fixed

Both guards shipped in [`app/webrtc/rate_limit.py`](../cloud-container/backend/app/webrtc/rate_limit.py):

- **Rate limit** — 5 renegotiations per operator per robot per minute, `429` beyond that. Checked *before* the viewer lock, so the lock check itself can't be hammered.
- **Viewer lock** — `videoviewer:{robot_id}` in Redis. The same operator re-offering always succeeds and refreshes the claim (that is the ordinary reconnect path). A *different* operator gets `409 Conflict` naming the current holder, unless they pass `takeover: true`. Takeover stays possible on purpose — "the instructor needs the feed back" is real — it just has to be deliberate.
- A timed-out relay releases the claim, so a failed negotiation doesn't lock the robot for the full TTL.
- New `GET`/`DELETE /robots/{id}/webrtc/viewer` let the UI show who holds the feed and release it on close.
- **Frontend**: `409` became its own `'in-use'` state rather than a generic failure, and the Robot page shows a **"Take over video"** button — a recoverable prompt instead of a dead end.

**Verified live with 8 concurrent offers: exactly 5 passed through and 3 returned `429`** — Redis's atomic `INCR` holding under real concurrency, which is the case a sequential test would have missed. Plus 12 tests in [`test_webrtc_rate_limit.py`](../cloud-container/tests/test_webrtc_rate_limit.py) against live Redis, including per-operator and per-robot scoping (so one client can't rate-limit everyone else) and `test_release_by_a_non_holder_does_not_free_the_feed` (so a superseded viewer's late release can't hand the robot to whoever asks next).

*A note on sequential testing:* the first live attempt showed six `504`s and no `429`, which looked like a broken limiter. It wasn't — each offer blocks 20s waiting for the absent robot, so six sequential requests spanned 120s and the 60s window reset twice. Concurrency was both the correct test and the realistic attack shape.

---

### F4 — SDP is unbounded, unvalidated, and reaches a C parser

**Severity: High** · [`models.py`](../cloud-container/backend/app/models.py), [`sdp_utils.py`](../robot-container/robot_agent/sdp_utils.py)

```python
class WebRTCOfferRequest(BaseModel):
    sdp: str          # no max_length, no format validation
```

That string is accepted from the browser, published verbatim to MQTT, and handed to **GStreamer's SDP parser and `webrtcbin`** — C libraries — on the robot. It is also processed by `sdp_utils.py`'s regexes on the way back.

Three distinct risks: an oversized body is a memory and bandwidth amplifier into F2's path; a malformed SDP is untrusted input reaching a C parser on the least-hardened machine in the system; and the regexes in `sdp_utils.py` run over attacker-influenced text.

**Fix — validate at the API boundary, where it is cheapest:**

```python
from pydantic import BaseModel, Field, field_validator

class WebRTCOfferRequest(BaseModel):
    # A real browser offer is 2-6 KB. 64 KB is generous headroom and still
    # far below anything that stresses the broker or the robot's parser.
    sdp: str = Field(max_length=65_536)

    @field_validator("sdp")
    @classmethod
    def must_look_like_sdp(cls, v: str) -> str:
        if not v.startswith("v=0"):
            raise ValueError("not a valid SDP offer")
        if "m=video" not in v:
            raise ValueError("SDP offer contains no video media section")
        return v
```

This is not a substitute for GStreamer being robust — it is the cheap filter that stops the obvious cases from ever reaching it.

**Verify:** post a 1 MB `sdp` and expect `422`, not a robot-side crash.

#### ✅ Fixed

`Field(max_length=65_536)` plus a `field_validator` requiring `v=0` at the start and an `m=video` section.

**Verified live** against the running backend: a 1 MB SDP → `422 string_too_long`; `<html>not an sdp</html>` → `422 not an SDP offer (must begin with 'v=0')`; an audio-only SDP → `422`; and a well-formed offer passed validation and reached the relay (`504`, correct with no robot running). Plus 5 tests in `test_input_limits.py`.

---

### F5 — Robot container runs as root and mounts the host X11 socket read-write

**Severity: Medium** · [`robot-container/docker/Dockerfile`](../robot-container/docker/Dockerfile), [`docker-compose.yml:299`](../docker-compose.yml#L299)

The robot container has **no `USER` directive** (runs as root), **no `cap_drop`** (deliberately deferred in the first pass), and mounts:

```yaml
volumes:
  - /tmp/.X11-unix:/tmp/.X11-unix:rw
environment:
  DISPLAY: ${DISPLAY:-}
```

with the Makefile running `xhost +local:docker`.

**Why this matters more than it looks.** X11 has no meaningful isolation between clients on the same display. Any process with access to that socket can log keystrokes from other windows, capture the screen, and inject synthetic input — across the entire host desktop session, not just the container. Combined with root inside the container, a compromised robot container is a realistic path to compromising the developer's whole session.

This is a *development convenience* (watching Gazebo's GUI) that lives in the **default** compose file, so it applies on every `make up` — including on a machine that also has a browser logged into production.

**Fix — move it to an opt-in overlay, exactly the pattern this project already uses for the camera:**

```bash
# docker-compose.gui.yml  (new — mirrors docker-compose.camera.yml)
services:
  robot:
    volumes:
      - /tmp/.X11-unix:/tmp/.X11-unix:ro    # read-only is sufficient
    environment:
      DISPLAY: ${DISPLAY:-}
```

Remove both from `docker-compose.yml`, drop `xhost +local:docker` from the default `make up` path, and add a `make up-gui` target that applies the overlay. Prefer `xhost +SI:localuser:$(id -un)` over the blanket `+local:docker` when it is used.

**Also add a non-root user to the robot Dockerfile.** ROS2 and GStreamer do not require root; the container needs device access for a camera, which is handled by group membership rather than by being root.

#### ✅ Fixed

**X11 — moved out of the default path entirely.** `DISPLAY`, `QT_X11_NO_MITSHM`, and the `/tmp/.X11-unix` mount now live only in the new [`docker-compose.gui.yml`](../docker-compose.gui.yml), mounted **read-only**, applied only by `make up-gui`. `make up`, `up-camera`, and `up-test-pattern` no longer touch the host X server at all. The `xhost` grant also narrowed from the blanket `+local:docker` (every local connection, including other containers) to `+SI:localuser:$(id -un)` — your user only — and now runs only under `up-gui`.

**Non-root — the robot container now runs as `robot` (uid 1000)** with `HOME=/home/robot`. Placed after every `COPY` and the `colcon build` so those layers stay cached: the change added **no measurable disk**, which mattered on a host already at 94%. Build artefacts stay root-owned and world-readable, so the runtime user can read its code but **cannot modify it** — a defence-in-depth bonus the finding didn't ask for. `make test-robot` and the integration script now run the test path with `-u root`, since `docker cp` lands files root-owned and pytest writes `.pytest_cache` beside them.

**Verified:** `whoami` → `robot`, `uid=1000`; `~/.ros/log` and `~/.gazebo` writable (both matter — ROS2 writes logs to the former, Gazebo caches models in the latter, and a missing writable `HOME` fails at startup in ways that look unrelated to permissions); all three `setup.bash`/`setup.sh` files still source; `robot_agent.main` imports; `:8080` binds unprivileged; `/robot/robot_agent/main.py` is not writable. Compose overlays validated, including `camera` + `gui` combined.

**Gazebo and ROS2 verified running as the non-root user**, via a bounded test rather than the full stack. The host was already carrying 3.4 GB of swap against 2.5 GB free, so `make up-gui` would have risked the swap-thrash freeze this project's own compose file warns about. Instead the robot image was run directly with a hard `--memory=1500m` cap — so an overrun OOM-kills the container rather than the host:

- `gzserver` starts, loads a world, and connects to its master as `uid 1000`
- `~/.gazebo` and `~/.ros/log` are created and owned by `robot:robot` — the permission-sensitive part, and the exact thing a non-root switch breaks when `HOME` isn't writable
- ROS2 resolves `robot_cloud_bridge` and `simulation.launch.py`, the daemon starts, and the graph is reachable
- The only errors are `Can't open display` and ALSA audio — both expected in a headless container, neither permission-related

> **Still unverified: the full Turtlebot3 world with spawn, camera, LiDAR, and the agent all running together under sustained load.** The permission question — the one a non-root switch actually threatens — is answered. What remains untested is resource behaviour at full scale on a machine that isn't already swapping. **Run `make up-gui` once on a host with real headroom** to close that out.

---

### F6 — Robot MQTT has no TLS support in code

**Severity: Medium** · [`robot_agent/config.py`](../robot-container/robot_agent/config.py)

The robot's MQTT config exposes only `host` and `port` — there are **no `tls`, `ca_certs`, `certfile`, or `keyfile` fields**, and `mqtt_client.py` never calls paho's `tls_set()`. Enabling TLS is therefore a **code change**, which quietly contradicts this project's own "config over hardcoding" principle that [`docs/11-aws-migration.md`](11-aws-migration.md) audits and depends on.

**Fix — add the fields now, default off**, so the migration to TLS (and later to AWS IoT Core's mutual TLS) is a deployment change:

```python
# config.py
mqtt_tls_enabled: bool = False
mqtt_ca_certs: Optional[str] = None
mqtt_certfile: Optional[str] = None      # per-device cert (see target-architecture D3)
mqtt_keyfile: Optional[str] = None

# mqtt_client.py, before connect()
if config.mqtt_tls_enabled:
    self._client.tls_set(
        ca_certs=config.mqtt_ca_certs,
        certfile=config.mqtt_certfile,
        keyfile=config.mqtt_keyfile,
    )
```

This is the same change that later carries per-device certificates, so it is not throwaway work.

#### ✅ Fixed

TLS config added to **both** MQTT clients — `MQTT_TLS_ENABLED`, `MQTT_TLS_CA_CERTS`, `MQTT_TLS_CERTFILE`, `MQTT_TLS_KEYFILE`, `MQTT_TLS_INSECURE` — defaulted off so the local stack is unchanged. `tls_set()` is called before `connect()` in both, which matters: paho applies TLS at socket creation, so a later call silently does nothing.

The broker gained a **conditional** TLS listener on 8883. It is appended by the entrypoint at runtime rather than committed into `mosquitto.conf`, because Mosquitto refuses to start when a listener references certificate files that don't exist — which would break every zero-config `docker compose up` on a machine that never generated certs. Presence of the mounted certs is the switch. `scripts/generate-dev-certs.sh` produces a throwaway CA and broker cert (with the `subjectAltName` modern TLS clients actually verify — a cert without it fails even when the CN looks right).

**Verified for real, not just wired:**

- `make mqtt-tls-check` — publish over TLS with the CA succeeds; the same publish without a trusted CA is refused.
- Through the **exact paho path both clients use**: connects with the trusted CA, and fails with a genuine `SSLCertVerificationError` against a *different* CA. That second half is the one that matters — it proves verification is real rather than decorative.
- **The backend service itself**, end to end: `MQTT TLS enabled (ca=…)` → `MQTT connected to mosquitto:8883` → `mqtt_connected: true`, with the broker logging `Client backend negotiated TLSv1.3 cipher TLS_AES_256_GCM_SHA384`.
- 6 tests in [`test_config_tls.py`](../robot-container/tests/test_config_tls.py), including `test_falsey_strings_do_not_enable_tls` — `bool("false")` is `True` in Python, so without explicit parsing, setting `MQTT_TLS_ENABLED=false` would switch TLS **on**.

Mutual TLS (`require_certificate true`) is the next step and is what the per-device certificate work needs; the client cert/key knobs are already in place for it.

---

### F7 — `robot_id` is simultaneously the MQTT username and a public identifier

**Severity: Medium (design)** · cross-cutting

`robot_id` appears in MQTT topics, in the ACL's `%u` substitution as the authentication username, in REST URLs, and in the unauthenticated metrics response (F1). Conflating a **public identifier** with an **authentication principal** means anything that leaks the former leaks half of the latter.

**Fix:** separate them. Keep `robot_id` as the public, human-meaningful identifier; give each device a distinct authentication identity (ideally a certificate CN, per [`target-architecture.md`](target-architecture.md) D3). Until then, treat every place `robot_id` is exposed as credential exposure.

#### ✅ Risk removed — and a correction to the framing above

Working through this changed my view of what the actual defect was.

Splitting `robot_id` from the MQTT username is **not** cheaply possible with Mosquitto's file-based ACLs, and shouldn't be forced. The `%u` pattern is what makes one ACL rule cover an entire fleet — onboarding robot #2 is issuing a credential, not editing a file. Breaking that coupling would mean a per-robot ACL entry for every robot, trading an elegant, scalable design for a worse one.

**The real defect was never that the username is public — it was that the password was shared.** A public username is only dangerous when the secret beside it is guessable. So:

- `MQTT_ROBOT_CREDENTIALS` accepts `robot_id:password` pairs, provisioning a **distinct credential per robot**. Unset falls back to the single-robot `ROBOT_ID`/`MQTT_ROBOT_PASSWORD` pair, so local dev stays zero-config.
- `robot_id` remaining the username is now a deliberate, documented design choice rather than an accident, and the F1 fix already removed its casual disclosure via `/metrics`.

**Verified live with two robots on different passwords — and note it holds at two independent layers:**

| Attempt | Result |
|---|---|
| `turtlebot3_02` with its own password | Connects |
| `turtlebot3_02` using `turtlebot3_01`'s password | **`Connection Refused: not authorised`** |
| `turtlebot3_01`, correctly authenticated, publishing to `robots/turtlebot3_02/telemetry` | **Never delivered** — ACL blocked it |

That last row is the important one: even a robot holding a *completely valid* credential cannot write into another robot's namespace. Credentials and ACL fail independently. Confirmed by checking **delivery to a subscriber**, not the publisher's return code — MQTT 3.1.1 has no "denied" ack, so a denied publish still gets a `PUBACK` and looks successful. Two tests in [`test_mqtt_acl.py`](../cloud-container/tests/test_mqtt_acl.py) pin both layers.

#### ✅ And now fully resolved — mutual TLS with certificate identity

The per-device certificate work described above as "long-term" is **implemented and verified**, which closes F7 properly rather than only mitigating it.

`scripts/issue-device-cert.sh <robot_id>` issues a client certificate whose **CN is the robot_id**, signed by the CA. With `MQTT_MUTUAL_TLS=true` the broker sets `require_certificate true` and `use_identity_as_username true`, so the certificate's CN *becomes* the MQTT username the `aclfile`'s `%u` pattern scopes on.

That keeps the design's best property — one ACL rule for the whole fleet, no per-robot file editing — while removing the weakness entirely: **there is no shared password left, and identity is proven by holding a CA-signed private key rather than asserted by sending a guessable string.**

**Verified live:**

| Attempt | Result |
|---|---|
| Valid `CN=turtlebot3_01` cert → its own topic | Connects and publishes, **no password sent at all** |
| No client certificate at all | `Error: The connection was lost` — rejected at the TLS layer |
| `turtlebot3_01`'s cert, **also passing `-u turtlebot3_02`** to claim another identity | **Blocked** — the CN wins over the supplied username |

*A note on how that last result was reached.* The first attempt at it reported "impersonation blocked" while the **positive control had also failed** — nothing arrived at all, which proves nothing. The cause was my observer: robots hold `write` but not `read` on telemetry, so `turtlebot3_02` could not subscribe to its own topic. Re-run with a `CN=backend` certificate (the role that *does* have read), the positive control passed and the negative result became meaningful. This file's own header warns about exactly that trap; it is easy to walk into anyway.

---

### F10 — Mosquitto warns it will refuse to load the password and ACL files

**Severity: Medium** · found in the broker logs while verifying F7

```
Warning: File /mosquitto/config/passwordfile owner is not mosquitto.
         Future versions will refuse to load this file.
Warning: File /mosquitto/config/aclfile owner is not mosquitto. …
```

Both files were root-owned. Today this is only a warning — but the two files named are the ones carrying *all* of this broker's authentication and every robot's topic scoping. A future image bump that starts enforcing it either stops the broker or, worse, loads without the ACL. That is a latent upgrade landmine sitting under the isolation guarantee F7 depends on, and it was free to remove.

**Fix:** the entrypoint now `chown`s the generated password file to `mosquitto:mosquitto`. The ACL file is bind-mounted read-only and can't be chown'd in place, so it is copied to a writable path, fixed there, and the runtime config points at the copy.

**Verified:** zero ownership warnings on startup, and — the check that actually matters after moving the file — cross-robot publishing is *still* blocked, confirmed by delivery.

---

### F11 — `MQTT_PORT` conflated two different ports

**Severity: Low** · found while enabling TLS end to end

`MQTT_PORT` was used both as the port clients connect to *and* as the host-published port (`"127.0.0.1:${MQTT_PORT}:1883"`). Setting `MQTT_PORT=8883` to move clients onto TLS therefore also remapped the host's plaintext publish to 8883, colliding with the TLS listener: `Bind for 127.0.0.1:8883 failed: port is already allocated`.

Not a vulnerability, but it made the secure configuration the one that fails to start — which is exactly the kind of friction that ends with someone turning TLS back off.

**Fix:** `MQTT_PORT` now means "the port clients connect to" (1883 plaintext / 8883 TLS). Host publishing moved to `MQTT_HOST_PORT` and `MQTT_TLS_HOST_PORT`.

---

### F8 — ROBOSTORE: unencrypted browser storage behind a stub gate

**Severity: Low** · [`robostore-poc/`](../robostore-poc/)

Accepts any email plus any 6-character password ([`LoginPage.tsx:55`](../robostore-poc/src/pages/LoginPage.tsx#L55)) and stores app data unencrypted in IndexedDB/localStorage. This is **correctly documented as a stub** in its own README, it runs as a separate Compose project on its own network, and it has client-side attempt limiting.

No change required — but two rules should be written down: it must **never be exposed beyond localhost**, and no real student data may ever enter it while the gate is a stub. Anything in IndexedDB is readable by any script on that origin and survives until explicitly cleared, including on shared classroom machines.

---

### F9 — The login rate limiter made the live test suite non-idempotent

**Severity: Medium** · found while verifying the fixes above · **self-inflicted by [`12-security-hardening.md`](12-security-hardening.md)**

Running the live suite twice within five minutes made **every** test fail with `429 Too Many Requests` instead of its real assertion.

**Two causes, compounding:**

1. `test_api_live.py` deliberately submits a wrong password (`test_login_rejects_wrong_credentials`) — a good test. Milestone 12's brute-force protection now counts that as a failed attempt.
2. `scripts/run-integration-tests.sh` never loaded `.env`, so the live tests fell back to the built-in defaults `operator` / `operator_dev_password`. Against any deployment that changed those — including this one — *every* login failed, and five failures tripped the lockout.

Before the hardening pass, cause 2 showed up as an honest `401`. Afterwards it became a wall of `429`s that hid the real problem.

**Why this is worth recording rather than quietly patching:** a security control that makes the test suite flaky is a security control somebody eventually deletes — usually at 6pm, usually without noting why. The control is right; the harness needed to account for it.

**Fix:**
- `scripts/run-integration-tests.sh` now sources `.env` (`set -a; . ./.env; set +a`) so live tests authenticate with the credentials the stack is actually running.
- `test_api_live.py` gained an `autouse` fixture clearing `login_*` keys from Redis before each test — keeping both the lockout protection *and* the test that proves wrong credentials are rejected.

**Verified:** the suite now passes **58/58 on two consecutive runs inside the five-minute lockout window** — precisely the scenario that failed before.

---

## 3. Prioritised action plan

**~~Today~~ — done.** F1 (both steps), F2, and F4 are fixed, tested, and verified live. F9 was found and fixed in the process. 19 regression tests added; the full suite passes 58/58 (cloud) and 45/45 (robot).

**~~This week~~ — done.** F3 (offer rate limit + viewer lock, with a takeover affordance in the UI) and F5 (X11 moved to an opt-in overlay; robot container now non-root) are both fixed and verified.

**~~This month~~ — done.** F6 (MQTT TLS, verified with a real TLS 1.3 handshake) and F7 (per-robot credentials, verified against impersonation at two layers) are both fixed, along with F10 and F11 found along the way.

**All findings are now closed.** What remains is deployment work rather than code:

1. **Run `make up-gui` on a host with real memory headroom** — closes the last untested aspect of F5 (full Turtlebot3 world under sustained load; permissions are already verified). This machine was at 94% disk carrying 3.4 GB of swap.
2. **Turn the guards on when you deploy.** The code now refuses to start insecure, but only when told it is production:
   ```bash
   ./scripts/generate-secrets.sh >> .env    # real credentials, incl. ROBOT_HEALTH_TOKEN
   #   then set ENVIRONMENT=production
   ```
   Both the backend and the robot will then refuse to boot with a dev default, with TLS off, with `MQTT_TLS_INSECURE` on, with an unset `ROBOT_HEALTH_TOKEN`, or with a `localhost` CORS origin.
3. **Replace the development CA.** `scripts/generate-dev-certs.sh` keeps its private key unprotected beside the certificates and nothing rotates — fine for a laptop, never for a deployment. Issue from a managed CA, which is also exactly what AWS IoT Core expects ([`11-aws-migration.md`](11-aws-migration.md)).

### Regression coverage now in place

Each finding is a one-line change away from returning, and a test is the only thing that would notice. What is now guarded automatically:

| Guard | Test |
|---|---|
| `/health` never leaks `robot_id`, even while open | `test_health_never_leaks_robot_id_even_when_open` |
| `/metrics` and `/status` reject a missing or wrong token | `test_identity_bearing_endpoints_reject_*` |
| Oversized MQTT payload dropped before `json.loads` | `test_oversized_payload_is_dropped_before_parsing` |
| The payload ceiling can't be quietly raised back into DoS range | `test_the_ceiling_is_bounded_and_sane` |
| Oversized / malformed / audio-only SDP rejected | `test_oversized_sdp_is_rejected`, `test_sdp_not_starting_with_version_field_is_rejected` |
| Sixth offer in a minute returns 429 | `test_offer_beyond_the_limit_is_rejected` |
| One operator can't rate-limit everyone else | `test_rate_limit_is_scoped_per_operator` |
| A second viewer can't silently kill the first | `test_second_operator_is_rejected_without_takeover` |
| A superseded viewer's late release can't free the current feed | `test_release_by_a_non_holder_does_not_free_the_feed` |
| `MQTT_TLS_ENABLED=false` doesn't accidentally enable TLS | `test_falsey_strings_do_not_enable_tls` |
| TLS stays off by default, and insecure mode is never the default | `test_tls_is_off_by_default`, `test_insecure_mode_is_off_by_default` |
| A robot can't authenticate as a different robot | `test_a_robot_cannot_authenticate_as_a_different_robot` |
| An authenticated robot can't publish into another's namespace | `test_a_robot_cannot_publish_into_another_robots_namespace` |

---

## 4. What the audit cleared

Stated explicitly, because a findings list without a coverage list is not a review:

| Checked | Result |
|---|---|
| Secrets in git history (`git log --all -- .env`) | **Clean** — `.env` was never committed |
| Credentials in log output | **Clean** — no password, token, or secret is ever logged |
| XSS sinks in either frontend (`dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`) | **Clean** — none present in either app |
| SQL injection | **Clean** — every query is parameterised via asyncpg |
| Command injection via the control path | **Clean** — closed `Literal` enum cloud-side *and* a `KNOWN_COMMANDS` set robot-side ([`dispatcher.py:15`](../robot-container/robot_agent/dispatcher.py#L15)); genuine defence in depth |
| Docker socket exposure | **Clean** — never mounted into any container |
| MQTT ACL correctness | **Sound** — the backend still cannot forge robot-reported state |
| First-pass hardening (Redis auth, JWT revocation, WS tickets, login lockout, audit chain) | **Holding** — re-verified, all still effective |

---

## 5. How these relate to the other documents

- [`12-security-hardening.md`](12-security-hardening.md) — the first pass. Its fixes still hold; F1 is an omission from it.
- [`architecture-assessment.md`](architecture-assessment.md) — the multi-tenancy and scale gaps. F7 is the code-level root of the identity problem described there.
- [`target-architecture.md`](target-architecture.md) — F6 and F7 are prerequisites for decision **D3** (per-device certificates); F3's viewer lock is a natural extension of the existing session-lock pattern.

**These findings are all in the *current* system.** They are worth fixing now regardless of whether the multi-institution plan proceeds — F1 through F4 in particular are cheap, and three of the four are pure configuration.

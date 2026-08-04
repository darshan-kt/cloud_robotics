# 08 — WebRTC Signalling

> **Status: complete.** `dev_signalling_server.py` (Milestone 6's throwaway HTTP endpoint) is deleted. Real, MQTT-mediated signalling now runs the entire offer/answer exchange through the backend, exactly as [`00-overview.md`](00-overview.md) always said it would. Verified with a real Chrome browser negotiating entirely through the new path: video decodes (`videoWidth: 640×480`, `currentTime` advancing, `rtp_packets_sent` climbing) with the old dev server completely gone.

## What this step is

The last piece of the video path's plumbing:

```
Camera → ROS2 → GStreamer → WebRTC → Browser
```

Milestone 6 built everything except how the browser and the robot actually find each other and exchange an SDP offer/answer - it used a throwaway HTTP server on the robot itself as a stand-in, explicitly temporary, its own docstring promising deletion here. This milestone builds the real thing: `POST /robots/{id}/webrtc/offer` on the backend, which relays the offer to the robot over MQTT and relays the answer back - the same MQTT-only boundary every other robot interaction in this project already respects (see [`00-overview.md`](00-overview.md)'s "why does the backend never talk to ROS2 directly").

## Why it's needed

### Why does signalling need its own MQTT topics, split by direction?

Milestone 3's original topic contract sketched a single `camera` topic, direction "robot → backend", before signalling's actual shape was designed. That was never going to be enough: negotiating WebRTC is inherently two-way — the browser's offer has to *reach* the robot somehow. This milestone splits it into `camera/offer` (backend → robot) and `camera/answer` (robot → backend), each with its own ACL grant (see `aclfile`). `docs/03-mqtt-layer.md`'s contract table is updated to match - a doc that goes stale the moment the code it describes changes isn't documentation, it's a trap for the next reader.

### Why is the backend allowed to publish `camera/offer`, when it's explicitly *not* allowed to publish telemetry/health/status?

This looks like it might weaken the security boundary `docs/03-mqtt-layer.md` established ("the only thing the backend is trusted to originate is commands") - it doesn't, and the reason is worth being precise about. The telemetry/health/status restriction exists specifically to stop the backend *impersonating a robot's own self-reported state* - a compromised backend shouldn't be able to lie about a robot's battery level. An SDP offer isn't a robot self-report at all; it's a negotiation the backend originates on an operator's behalf, the same category `cmd` is already in - not a new exception, an instance of one that already existed. `aclfile`'s own comments say this explicitly rather than leaving it to be inferred.

### Why does MQTT need a hand-rolled `request_id`, when the robot already has one HTTP-request-per-offer today?

MQTT (this project targets plain 3.1.1, not MQTT 5's response-topic/correlation-data properties) has no built-in idea of "this message is a reply to that one." An HTTP request/response naturally correlates itself - the deleted `dev_signalling_server.py` never needed to think about this. Over pub/sub, the smallest version of that correlation is built by hand: `webrtc/relay.py` generates a `request_id` per offer, publishes it alongside the SDP, and the robot echoes it back with the answer. `WebRTCSignallingRelay` keeps an `asyncio.Future` per in-flight `request_id`, resolved the moment a matching answer arrives - proven correct for concurrent, independent offers in `test_webrtc_relay.py`, not just the single-request case.

### Why does the robot need a dedicated background thread per offer, when `cmd` handling doesn't?

`VideoStreamer.handle_offer()` genuinely blocks - it waits for ICE gathering to finish, up to ~10 seconds (see [`06-video-streaming.md`](06-video-streaming.md)). MQTT message callbacks run on the client's own network thread (`mqtt_client.py`'s `_handle_message`); running a 10-second blocking call directly there would stall *every other inbound message* for that whole window, including the next `cmd`. `agent.py`'s `_on_camera_offer` spins a dedicated `threading.Thread` per offer and returns immediately - the same "own thread for blocking work" shape already used by `VideoStreamer`'s GLib loop and `RealROSAdapter`'s spin thread, applied here for the same reason.

### Why REST (`POST /robots/{id}/webrtc/offer`), not a WebSocket, for the browser-facing side?

This project already has a real precedent for choosing between the two: `POST /robots/{id}/control` (REST, one discrete command) versus `/ws/teleop` (WebSocket, a continuous interactive stream) - see [`07-cloud-backend.md`](07-cloud-backend.md). An SDP offer/answer exchange is fundamentally a *one-shot* request/response, happening once per viewing session, not a stream of events - REST is the architecturally correct fit here, not just the simpler one. A future trickle-ICE design (incremental candidates instead of waiting for gathering to complete) would change this calculus; non-trickle, as this pipeline already commits to, doesn't need it.

### Why doesn't watching video require holding the robot's control session?

`api/webrtc.py`'s endpoint requires authentication but deliberately does **not** call `SessionManager.require_holder()` the way `POST /robots/{id}/control` does. Video (Path 2) and control (Path 1) are independent concerns by design (`docs/00-overview.md`) - an operator who only wants to *watch* a robot someone else is driving shouldn't need to fight them for the control lock first. Any authenticated operator can open a video feed; only the session holder (or an emergency `stop`) can move the robot.

## What it does

- **`cloud-container/mosquitto/aclfile`** — `camera` split into `camera/offer` (backend write / robot read) and `camera/answer` (robot write / backend read), with the reasoning above written directly into the file's own comments.
- **`robot_agent/topics.py`** — `camera_offer_topic()`/`camera_answer_topic()`.
- **`robot_agent/agent.py`** — subscribes to its own `camera/offer` in `connect()`; `_on_camera_offer()` (MQTT callback, spins the background thread) and `_handle_camera_offer_blocking()` (runs on it: calls `VideoStreamer.handle_offer()`, publishes the answer, updates the new `webrtc_offers_handled`/`webrtc_offers_failed` metrics - real observability for "is signalling actually working", not just "did the process not crash").
- **`robot_agent/dev_signalling_server.py`** — **deleted**, along with its wiring in `main.py`, its `dev_signalling_port` config field, its `DEV_SIGNALLING_PORT` env var, and its `8081` port mapping/`EXPOSE` in `docker-compose.yml`/`Dockerfile`/`.env.example`.
- **`cloud-container/backend/app/webrtc/relay.py`** (new) — `WebRTCSignallingRelay`: `relay_offer()` (publish, correlate, await, timeout) and `handle_answer()` (resolve the matching `Future`).
- **`cloud-container/backend/app/mqtt/topics.py`/`service.py`** — `camera_offer_topic()`/`camera_answer_topic_wildcard()`; `parse_topic()` generalized to handle a multi-segment suffix (`camera/answer`, not just a single level like `status`); `publish_camera_offer()`; subscribes to `camera/answer` fleet-wide on connect.
- **`cloud-container/backend/app/api/webrtc.py`** (new) — `POST /robots/{id}/webrtc/offer`.
- **`cloud-container/backend/app/main.py`** — constructs `WebRTCSignallingRelay`, wires `mqtt_service.on_message("camera/answer", relay.handle_answer)` alongside the registry's own handlers, includes the new router.
- **Tests** — `cloud-container/tests/test_webrtc_relay.py` (unit, fake MQTT: correlation, timeout, unmatched/late answers, concurrent independence); four new cases in `test_mqtt_acl.py` (backend can publish `camera/offer` and the robot receives it; the robot *cannot* publish its own `camera/offer`; the robot can publish `camera/answer` and the backend receives it; the backend *cannot* publish `camera/answer`); `robot-container/tests/test_agent.py` gained coverage for `_on_camera_offer`/`_handle_camera_offer_blocking` (success, malformed payload, `VideoStreamer` failure, and the real MQTT-delivery-through-a-background-thread path).

## Verification

- **44/44 backend tests, 32/32 robot tests pass** against the real live stack (`docker compose up -d`) - including the four new ACL boundary tests proving the `camera/offer`/`camera/answer` split is enforced by the broker, not just by convention.
- **A real Chrome browser, negotiating entirely through the new path** - no hosted test page, no `dev_signalling_server.py` (it no longer exists): a real HTTP page (Chrome's Private Network Access policy blocks an opaque-origin page from reaching `localhost` at all, so this had to be a real `http://localhost` origin, not an injected blank page - itself a faithful preview of what Milestone 9's real frontend will look like) does the full RTCPeerConnection dance, `POST`s its offer to `/robots/{id}/webrtc/offer` with a real bearer token, and sets the returned answer as its remote description:
  - `iceConnectionState` reaches `connected`
  - `<video>` reports `videoWidth: 640, videoHeight: 480`, `readyState: 4`, `paused: false`
  - `currentTime` advances in real time (`0.788s → 3.807s` over a real 3-second wait)
  - the robot's own `/metrics` shows `webrtc_offers_handled: 1` and `rtp_packets_sent` climbing continuously (`242` and rising) against the real connected peer
- Milestone 6's video pipeline itself is unaffected - `VideoStreamer.handle_offer()` didn't change at all; only what calls it did.

## Running it yourself

```bash
docker compose up -d
docker compose logs -f backend   # watch: MQTT connect, "Re-subscribed to robots/+/camera/answer"

TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"operator","password":"operator_dev_password"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# a real offer needs a real RTCPeerConnection (a browser) - see
# cloud-container/tests/test_webrtc_relay.py for the pub/sub correlation
# logic in isolation, or drive a real browser against this endpoint the
# way this milestone's own verification did.
curl -s -X POST http://localhost:8000/robots/turtlebot3_01/webrtc/offer \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"sdp": "<a real browser offer SDP>"}'

pip install -r cloud-container/tests/requirements.txt
pytest cloud-container/tests/ robot-container/tests/ -v

docker compose down
```

## Next steps

- **Milestone 9**: the React frontend - a real `<video>` element driven by exactly the flow this milestone's own verification page exercised by hand (`fetch` the offer/answer through the backend, `RTCPeerConnection` the rest).
- Noted, not blocking: `handle_offer()`'s known codec-negotiation fragility from Milestone 6 (real, fixed, documented there) is unaffected by this milestone - a robot that can't answer an offer natively still can't, regardless of transport; this milestone only changed how the offer gets there. Trickle ICE (incremental candidates instead of waiting for full gathering) remains unneeded as long as non-trickle keeps working - revisit only if gathering latency becomes a real problem.

Next: [09 — The Frontend](09-frontend.md) (Milestone 9) - complete.

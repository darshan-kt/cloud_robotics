# cloud-container/tests/

**Purpose:** tests for the cloud-container codebase, split by what they depend on (see `pytest.ini` at the `cloud-container/` root for shared config).

**Contains:**
- `test_mqtt_acl.py` (Milestone 3, extended Milestone 8) — MQTT authentication/ACL integration tests against a live Mosquitto, including the `camera/offer`/`camera/answer` directional boundary added in Milestone 8.
- `test_auth.py` (Milestone 7) — unit tests for `auth/tokens.py`/`auth/service.py`, pure functions, no live services.
- `fake_registry.py`, `fake_session_manager.py`, `fake_mqtt_service.py` + `test_fleet_manager.py` (Milestone 7) — unit tests for `fleet/manager.py`'s orchestration/business rules (session ownership, the `stop` safety override), using in-memory doubles.
- `test_registry_and_sessions_live.py` (Milestone 7) — integration tests for `registry/store.py`/`sessions/manager.py` against real, live Postgres + Redis.
- `test_api_live.py` (Milestone 7) — end-to-end HTTP/WebSocket tests against the real running backend.
- `test_webrtc_relay.py` (Milestone 8) — unit tests for `webrtc/relay.py`'s offer/answer correlation logic (fake MQTT, no live broker) - timeout, unmatched/late answers, and independent concurrent offers.
- `test_frontend_e2e.py` (Milestone 10) — real-browser end-to-end tests (real Chrome via Playwright, not a synthetic engine) against the real running frontend: login, live dashboard, actually-decoding WebRTC video, arrow-button + keyboard teleop proven against the robot's own `/metrics`, emergency stop, health/settings, logout — the one file in this suite that crosses all three containers (browser → React → FastAPI → MQTT → robot) in a single assertion chain. Also the permanent regression test for the shared-`webrtcbin` reconnect bug Milestone 9 found (`test_webrtc_survives_reload_and_renavigation`). See `docs/09-frontend.md` and `docs/10-testing-strategy.md`.

**Running:**
```bash
pip install -r cloud-container/tests/requirements.txt

# Fast, no live services needed:
pytest cloud-container/tests/test_auth.py cloud-container/tests/test_fleet_manager.py cloud-container/tests/test_webrtc_relay.py -v

# Everything, against the real stack (test_frontend_e2e.py needs a real,
# locally-installed Chrome - see that file's own header):
docker compose up -d --build
pytest cloud-container/tests/ -v

# Or, for the full three-container suite (robot + backend + frontend) in
# one command:
./scripts/run-integration-tests.sh
```

**Filled in:** Milestone 3 (MQTT ACL), Milestone 7 (auth/fleet/registry/sessions/API), Milestone 8 (WebRTC relay), Milestone 10 (real-browser frontend E2E).

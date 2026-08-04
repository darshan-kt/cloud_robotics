# 10 — Testing Strategy

> **Status: complete.** Every layer this project has built now has a real test behind it, and they run together, in the right order, against a live three-container stack, with one command: `./scripts/run-integration-tests.sh`. The new piece this milestone adds — `test_frontend_e2e.py` — is a real, unmodified Chrome browser driving the actual frontend through the actual backend to the actual robot, with the robot's own `/metrics` as the source of truth, not the browser's UI state. **80/80 tests pass**: 32 robot, 48 cloud (44 existing + 4 new).

## What this step is

Every milestone from 3 onward wrote real tests as it went — this isn't a milestone that invents testing from nothing. What was still missing:

- A frontend test that drives the **real** app in a **real** browser, the way Milestones 6, 8, and 9 each verified by hand but never turned into something that runs again on its own.
- A permanent regression test for the two real bugs Milestone 9's verification found (see [`docs/09-frontend.md`](09-frontend.md)) — without one, nothing stops either from quietly coming back.
- One command that runs *everything*, in the right order, against a live stack — rather than three separately-documented procedures a contributor has to remember to run all of.

This milestone closes all three gaps, and fixes one more it found in the process (below).

## Why it's needed

### Why real Chrome via Playwright, not a component-testing framework (Jest/React Testing Library) or a headless-only engine?

This project's whole verification ethos, established as far back as Milestone 5's `MockROSAdapter`/`RealROSAdapter` split and repeated at every milestone since, is: fake what you must for unit-speed feedback, but prove the real thing works against the real thing at least once, honestly, before calling it done. A component test with a mocked `RTCPeerConnection` would prove the React code renders the right JSX for a given hook state — it would **not** have caught either of Milestone 9's real bugs, both of which lived in actual browser ICE/WebRTC behavior no mock reproduces. `test_frontend_e2e.py` uses `channel="chrome"` specifically (not Playwright's bundled Chromium) for the same reason docs/09 gives: the mDNS candidate behavior that broke the first connection is a real-Chrome-specific privacy feature, not something a generic engine necessarily replicates.

### Why does `test_webrtc_survives_reload_and_renavigation` exist as its own test, separate from the main journey test?

Because it's a **regression test**, not a feature test — its entire reason to exist is that this exact scenario (reload, or navigate away and back) once broke silently, and nothing before Milestone 9 would have caught it. Folding it into the main journey test would bury the specific thing it's protecting: three sequential connections, each independently proven to be really decoding video, with the robot's own `webrtc_offers_handled`/`webrtc_offers_failed` counters as the final check that nothing failed along the way.

### Why prove teleop commands "worked" by polling the robot's own `/metrics`, not just asserting the UI updated?

The same reasoning `docs/06-video-streaming.md` already established the hard way for video (a UI/signalling success and *actual media flowing* turned out to be different questions): a button showing as "active" or a WebSocket returning `{"status": "sent"}` proves the browser *tried*, not that the command crossed MQTT and reached `CommandDispatcher.dispatch()` on the robot. `test_full_operator_journey` reads `commands_received` off the robot's real `/metrics` before and after every teleop action specifically so the assertion is about the robot, not about the browser's opinion of itself.

### Why does `scripts/run-integration-tests.sh` `pip install` inside the robot container instead of assuming its dependencies are already there?

Because they aren't, on purpose — `robot-container/tests/requirements.txt`'s own header says test dependencies are "kept separate... so pytest never ends up in the production robot image," and the Dockerfile's `COPY` list confirms it: no `tests/`, no `pytest.ini` ship in the built image. Investigating why 5 of 32 robot tests looked skipped when run directly against the built image (rather than failing outright) is what actually found a real, previously-unnoticed gap - see below.

## What it does

- **`cloud-container/tests/test_frontend_e2e.py`** (new) — `test_unauthenticated_root_redirects_to_login`, `test_wrong_credentials_are_rejected`, `test_full_operator_journey` (login → dashboard → real decoding video → button + keyboard teleop, each proven against robot `/metrics` → emergency stop → health/settings → logout → protected-route re-lock), `test_webrtc_survives_reload_and_renavigation` (the Milestone 9 regression test). Skips gracefully, not failing, if the stack or a robot isn't up — same convention `test_api_live.py` established in Milestone 7.
- **`cloud-container/tests/requirements.txt`** — added `playwright==1.61.0` (the Python package only; no bundled-browser download needed, since this deliberately drives the real, locally-installed Chrome).
- **`scripts/run-integration-tests.sh`** (new, and a new top-level `scripts/` folder — repo-wide tooling, distinct from `robot-container/scripts/`'s in-image scripts) — runs the robot suite (copying `tests/` and `pytest.ini` into the live container, installing pinned test deps, then `pytest`) followed by the full `cloud-container/tests/` suite, against a stack that's either already up or brought up with `--up`.
- **`cloud-container/tests/README.md`** — documents the new file and the one-command path.

## Verification

Running `./scripts/run-integration-tests.sh` against the real stack (`CAMERA_TEST_PATTERN_FALLBACK=true` for this run only, so the video assertions have real frames to decode — see `docs/06-video-streaming.md`'s established "off by default, explicit opt-in" contract):

```
=== Robot-side tests ===
32 passed in 0.69s

=== Cloud-side tests ===
48 passed in 45.70s

=== ALL SUITES PASSED ===
```

**A real bug found while building the runner, not the new test file itself:** the previous milestone summaries had claimed "32/32 robot tests pass," but running them the way a contributor actually would — `docker compose exec` into the real, built robot container — showed only 27 passing and 5 silently *skipped* (not failed, which is why it went unnoticed): `pytest-asyncio` needs `asyncio_mode = auto` to run bare `async def` tests without a `@pytest.mark.asyncio` on each one, that setting lives in `robot-container/pytest.ini`, and **`pytest.ini` was never copied into the container** — same deliberate exclusion as `tests/` itself, just not one anyone had actually exercised end-to-end before. `scripts/run-integration-tests.sh` copies both, and installs the exact pinned `pytest==8.3.3`/`pytest-asyncio==0.24.0` (the container's system `pytest` is an ancient `6.2.5` from the ROS2 Humble apt packages, incompatible with modern `pytest-asyncio` config) — closing the gap for real rather than leaving it as a known skip.

## Running it yourself

```bash
cp .env.example .env
CAMERA_TEST_PATTERN_FALLBACK=true docker compose up -d --build

pip install -r cloud-container/tests/requirements.txt
./scripts/run-integration-tests.sh
```

Or drive each piece separately:

```bash
# Robot side
docker cp robot-container/tests cloud-robotics-robot:/robot/tests
docker cp robot-container/pytest.ini cloud-robotics-robot:/robot/pytest.ini
docker compose exec robot bash -c "pip install -q -r /robot/tests/requirements.txt && cd /robot && python3 -m pytest tests/ -v"

# Cloud side (backend + real-browser frontend E2E)
pytest cloud-container/tests/ -v

# Just the new frontend E2E file
pytest cloud-container/tests/test_frontend_e2e.py -v
```

## Next steps

- **Milestone 11**: final documentation pass — architecture diagrams, a consolidated API/MQTT reference, and the AWS migration guide `docs/00-overview.md` has been pointing to since Milestone 1.
- Noted, not blocking: `test_frontend_e2e.py` runs headless by default (`headless=True`) for reproducibility in any environment, including a future CI runner — every one of this project's *diagnostic* verification passes (Milestones 6, 8, 9) also confirmed things work headed and headless produce the same result, so this isn't a coverage gap, just a default worth knowing about.
- Noted, not blocking: no CI workflow file exists yet to actually run `scripts/run-integration-tests.sh` on a schedule/PR - the script is written to be CI-ready (clear exit codes, `--up`/`--down` flags) but wiring an actual CI provider is out of this milestone's scope and this project's current single-machine-dev-sim stage.

Next: [11 — AWS Migration Guide](11-aws-migration.md) (Milestone 11) - not started yet.

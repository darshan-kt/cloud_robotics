"""Real-browser end-to-end tests for the operator journey (Milestone 9's
frontend) - the one file in this project's whole test suite that crosses
all three containers in a single assertion chain: a real Chrome browser
(via Playwright) -> React -> FastAPI -> MQTT -> the real robot, proven via
the robot's OWN `/metrics` endpoint, not just a 2xx HTTP status or a UI
state change. Every other test in this suite proves one layer works in
isolation; this proves the assembled system actually does, exercised
exactly the way a real operator would.

Uses a REAL, unmodified Chrome (`channel="chrome"`), not Playwright's own
bundled browser - see docs/09-frontend.md's WebRTC debugging story for why
that distinction mattered here specifically: the two real bugs that
verification surfaced (Chrome's mDNS ICE candidates, a shared `webrtcbin`
silently breaking reconnects) would not have been visible against a
synthetic engine, and `test_webrtc_survives_reload_and_renavigation` below
is the permanent regression test for the second one.

Requires the full stack up (`docker compose up -d --build`), including a
real robot reporting in - video/teleop assertions skip gracefully (not
fail) if no robot has ever registered, same convention as
test_api_live.py's robot-dependent tests.
"""
import json
import os
import socket
import time
import urllib.request

import pytest
from playwright.sync_api import Page, sync_playwright

FRONTEND_URL = os.environ.get("FRONTEND_TEST_URL", "http://localhost:3000")
BACKEND_URL = os.environ.get("BACKEND_TEST_URL", "http://localhost:8000")
ROBOT_HEALTH_URL = os.environ.get("ROBOT_HEALTH_TEST_URL", "http://localhost:8080")
OPERATOR_USERNAME = os.environ.get("OPERATOR_USERNAME", "operator")
OPERATOR_PASSWORD = os.environ.get("OPERATOR_PASSWORD", "operator_dev_password")


def _reachable(url: str) -> bool:
    host_port = url.split("://", 1)[1]
    host, _, port = host_port.partition(":")
    try:
        with socket.create_connection((host, int(port or 80)), timeout=2):
            return True
    except OSError:
        return False


def _robot_metrics() -> dict:
    with urllib.request.urlopen(f"{ROBOT_HEALTH_URL}/metrics", timeout=5) as resp:
        return json.loads(resp.read())


def _require_robot() -> None:
    if not _reachable(ROBOT_HEALTH_URL):
        pytest.skip("No robot reachable - bring up the robot container too to exercise this.")


@pytest.fixture(scope="module", autouse=True)
def _require_frontend_and_backend_reachable():
    if not _reachable(FRONTEND_URL):
        pytest.skip(f"Frontend not reachable at {FRONTEND_URL} - run `docker compose up -d --build` first.")
    if not _reachable(BACKEND_URL):
        pytest.skip(f"Backend not reachable at {BACKEND_URL} - run `docker compose up -d --build` first.")


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=True)
        yield b
        b.close()


@pytest.fixture()
def page(browser):
    # A fresh context per test - separate localStorage/cookies, so one
    # test's login doesn't leak into the next the way sharing a page
    # across tests would.
    context = browser.new_context()
    pg = context.new_page()
    yield pg
    context.close()


def _login(page: Page) -> None:
    page.goto(FRONTEND_URL, wait_until="networkidle")
    page.wait_for_url("**/login", timeout=10000)
    page.fill('input[type="text"]', OPERATOR_USERNAME)
    page.fill('input[type="password"]', OPERATOR_PASSWORD)
    page.click('button[type="submit"]')
    page.wait_for_url("**/dashboard", timeout=10000)


def _open_first_robot(page: Page) -> str:
    card = page.locator("a[href^='/robots/']").first
    card.wait_for(timeout=10000)
    robot_id = card.get_attribute("href").rsplit("/", 1)[-1]
    card.click()
    page.wait_for_url("**/robots/**", timeout=10000)
    return robot_id


def _assert_video_really_playing(page: Page) -> None:
    """Reaching connectionState 'connected' only proves signalling/ICE
    succeeded - the fake-video bug Milestone 6 found the hard way (see
    docs/06-video-streaming.md) was signalling succeeding while media
    never actually flowed. This checks the same three signals that
    milestone settled on as real proof: non-zero dimensions, readyState
    4 (HAVE_ENOUGH_DATA), and currentTime actually advancing."""
    page.wait_for_selector("text=Video: connected", timeout=20000)
    time.sleep(2)
    info = page.evaluate(
        """() => {
            const v = document.querySelector('video');
            return {videoWidth: v.videoWidth, readyState: v.readyState, t1: v.currentTime};
        }"""
    )
    time.sleep(1.5)
    t2 = page.evaluate("document.querySelector('video').currentTime")
    assert info["videoWidth"] > 0, f"video never decoded any frames: {info}"
    assert info["readyState"] == 4, f"video readyState never reached HAVE_ENOUGH_DATA: {info}"
    assert t2 > info["t1"], f"currentTime isn't advancing - media isn't actually flowing ({info['t1']} -> {t2})"


# --- auth boundary ---


def test_unauthenticated_root_redirects_to_login(page: Page):
    page.goto(FRONTEND_URL, wait_until="networkidle")
    page.wait_for_url("**/login", timeout=10000)
    assert "/login" in page.url


def test_wrong_credentials_are_rejected(page: Page):
    page.goto(FRONTEND_URL, wait_until="networkidle")
    page.wait_for_url("**/login", timeout=10000)
    page.fill('input[type="text"]', OPERATOR_USERNAME)
    page.fill('input[type="password"]', "not-the-real-password")
    page.click('button[type="submit"]')
    page.wait_for_selector("text=Invalid username or password", timeout=10000)
    assert "/login" in page.url


# --- the full operator journey ---


def test_full_operator_journey(page: Page):
    """Login -> live dashboard -> real decoding WebRTC video -> teleop
    (arrow button AND keyboard, each proven against the robot's own
    /metrics, not just the UI updating) -> emergency stop -> health/
    settings -> logout -> protected route re-locks. Stands in for one
    real operator's whole session, end to end."""
    _require_robot()

    _login(page)
    _open_first_robot(page)
    _assert_video_really_playing(page)

    assert _robot_metrics()["webrtc_offers_handled"] >= 1

    page.click("text=Take control")
    page.wait_for_selector("text=Session: connected", timeout=10000)

    before = _robot_metrics()["commands_received"]
    forward = page.locator('button[aria-label="forward"]')
    box = forward.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    time.sleep(0.3)  # ~6 ticks at 20Hz
    page.mouse.up()
    time.sleep(0.3)
    after = _robot_metrics()["commands_received"]
    assert after > before + 1, "holding the arrow button should send repeated throttled commands, not one"

    before = after
    page.click("body")
    page.keyboard.down("ArrowRight")
    time.sleep(0.3)
    page.keyboard.up("ArrowRight")
    time.sleep(0.3)
    after = _robot_metrics()["commands_received"]
    assert after > before + 1, "holding an arrow key should send repeated throttled commands, not one"

    before = after
    page.click("text=Emergency Stop")
    page.wait_for_selector("text=Stop sent.", timeout=10000)
    time.sleep(0.5)
    after = _robot_metrics()["commands_received"]
    assert after > before, "emergency stop must reach the robot even without holding control"

    page.click("text=Release control")
    page.wait_for_selector("text=Take control", timeout=10000)

    page.click("text=Health")
    page.wait_for_url("**/health", timeout=10000)
    page.wait_for_selector("text=cloud-robotics-backend", timeout=10000)

    page.click("text=Settings")
    page.wait_for_url("**/settings", timeout=10000)
    page.wait_for_selector(f"text={OPERATOR_USERNAME}", timeout=10000)

    page.click("text=Log out")
    page.wait_for_url("**/login", timeout=10000)
    assert page.evaluate("localStorage.getItem('cloud-robotics.auth')") is None

    # A protected route, visited directly (a real navigation, not
    # client-side routing) while logged out, must bounce back to /login -
    # proves the guard holds even on a fresh page load, not just
    # in-session navigation.
    page.goto(f"{FRONTEND_URL}/dashboard", wait_until="networkidle")
    page.wait_for_url("**/login", timeout=10000)


# --- regression test for Milestone 9's shared-webrtcbin bug ---


def test_webrtc_survives_reload_and_renavigation(page: Page):
    """Milestone 9 found that a SECOND real offer (a page reload, or
    navigating away from the Robot page and back - both completely
    ordinary things a real frontend does) silently corrupted the FIRST
    connection instead of establishing an independent one: GStreamer's
    webrtcbin models exactly one peer connection, and the original code
    reused a single one for the whole process's lifetime. See
    docs/09-frontend.md and video_streamer.py's _prepare_fresh_webrtcbin().
    This is the permanent regression test for that fix - three sequential
    connections, each independently proven to be really decoding video."""
    _require_robot()

    _login(page)
    _open_first_robot(page)
    _assert_video_really_playing(page)

    page.reload(wait_until="networkidle")
    page.wait_for_url("**/robots/**", timeout=10000)
    _assert_video_really_playing(page)

    page.click("text=Fleet")
    page.wait_for_url("**/dashboard", timeout=10000)
    _open_first_robot(page)
    _assert_video_really_playing(page)

    metrics = _robot_metrics()
    assert metrics["webrtc_offers_handled"] >= 3
    assert metrics["webrtc_offers_failed"] == 0

"""Unit tests for webrtc/relay.py's offer/answer correlation logic - a fake
MQTTService, no live broker needed. The real MQTT wiring (does an answer
actually arrive via a live broker) is proven separately, live, in
test_mqtt_acl.py and this milestone's real end-to-end verification - see
docs/08-webrtc-signalling.md.
"""
import asyncio

import pytest

from app.webrtc.relay import WebRTCRelayTimeoutError, WebRTCSignallingRelay
from fake_mqtt_service import FakeMQTTService

ROBOT_ID = "turtlebot3_01"


@pytest.fixture
def wired():
    mqtt = FakeMQTTService()
    relay = WebRTCSignallingRelay(mqtt)
    return relay, mqtt


async def test_relay_offer_publishes_and_resolves_on_matching_answer(wired):
    relay, mqtt = wired

    async def answer_soon():
        # Give relay_offer a moment to publish and start waiting, then
        # simulate the robot's answer arriving over MQTT with the SAME
        # request_id relay_offer generated.
        while not mqtt.camera_offers:
            await asyncio.sleep(0)
        robot_id, request_id, sdp = mqtt.camera_offers[0]
        assert robot_id == ROBOT_ID
        assert sdp == "offer-sdp"
        await relay.handle_answer(ROBOT_ID, {"request_id": request_id, "sdp": "answer-sdp"})

    answer_sdp, _ = await asyncio.gather(
        relay.relay_offer(ROBOT_ID, "offer-sdp", timeout=5),
        answer_soon(),
    )

    assert answer_sdp == "answer-sdp"


async def test_relay_offer_times_out_if_no_answer_arrives(wired):
    relay, _mqtt = wired

    with pytest.raises(WebRTCRelayTimeoutError):
        await relay.relay_offer(ROBOT_ID, "offer-sdp", timeout=0.05)


async def test_unmatched_answer_does_not_raise(wired):
    relay, _mqtt = wired

    await relay.handle_answer(ROBOT_ID, {"request_id": "no-such-request", "sdp": "answer-sdp"})  # must not raise


async def test_a_timed_out_requests_late_answer_is_ignored(wired):
    """A request_id is popped from the pending map as soon as it times out
    - an answer that arrives after that must not resurrect it or crash."""
    relay, mqtt = wired

    with pytest.raises(WebRTCRelayTimeoutError):
        await relay.relay_offer(ROBOT_ID, "offer-sdp", timeout=0.05)

    _robot_id, request_id, _sdp = mqtt.camera_offers[0]
    await relay.handle_answer(ROBOT_ID, {"request_id": request_id, "sdp": "too-late"})  # must not raise


async def test_concurrent_offers_are_correlated_independently(wired):
    """Two offers in flight at once must each get THEIR OWN answer, not
    each other's - the whole point of request_id."""
    relay, mqtt = wired

    async def answer_all_pending_in_reverse_order():
        while len(mqtt.camera_offers) < 2:
            await asyncio.sleep(0)
        for robot_id, request_id, sdp in reversed(mqtt.camera_offers):
            await relay.handle_answer(robot_id, {"request_id": request_id, "sdp": f"answer-for-{sdp}"})

    answer_1, answer_2, _ = await asyncio.gather(
        relay.relay_offer(ROBOT_ID, "offer-1", timeout=5),
        relay.relay_offer(ROBOT_ID, "offer-2", timeout=5),
        answer_all_pending_in_reverse_order(),
    )

    assert answer_1 == "answer-for-offer-1"
    assert answer_2 == "answer-for-offer-2"

import time

from robot_agent.mock_ros_adapter import MockROSAdapter


def test_odometry_and_battery_callbacks_fire_with_plausible_values():
    adapter = MockROSAdapter(robot_id="test-robot", update_interval_seconds=0.05)
    odometry_events = []
    battery_events = []
    adapter.subscribe_odometry(odometry_events.append)
    adapter.subscribe_battery(battery_events.append)

    adapter.start()
    try:
        adapter.publish_cmd_vel(0.3, 0.1)
        time.sleep(0.3)
    finally:
        adapter.stop()

    assert len(odometry_events) >= 2
    assert len(battery_events) >= 2
    assert odometry_events[-1].linear_velocity == 0.3
    assert odometry_events[-1].angular_velocity == 0.1
    assert all(0.0 <= b.percentage <= 100.0 for b in battery_events)


def test_battery_does_not_drain_while_idle():
    adapter = MockROSAdapter(robot_id="test-robot", update_interval_seconds=0.05)
    battery_events = []
    adapter.subscribe_battery(battery_events.append)

    adapter.start()
    try:
        time.sleep(0.3)  # never calls publish_cmd_vel - robot stays idle
    finally:
        adapter.stop()

    assert all(b.percentage == 100.0 for b in battery_events)


def test_stop_joins_the_background_thread():
    adapter = MockROSAdapter(robot_id="test-robot", update_interval_seconds=0.05)
    adapter.start()
    adapter.stop()
    assert not adapter._thread.is_alive()

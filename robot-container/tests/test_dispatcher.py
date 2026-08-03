from fake_ros_adapter import RecordingROSAdapter

from robot_agent.dispatcher import CommandDispatcher

LINEAR_SPEED = 0.5
ANGULAR_SPEED = 1.0


def _dispatcher():
    adapter = RecordingROSAdapter()
    dispatcher = CommandDispatcher(adapter, LINEAR_SPEED, ANGULAR_SPEED)
    return dispatcher, adapter


def test_forward_sets_positive_linear_velocity():
    dispatcher, adapter = _dispatcher()
    assert dispatcher.dispatch("forward") is True
    assert adapter.calls == [(LINEAR_SPEED, 0.0)]


def test_backward_sets_negative_linear_velocity():
    dispatcher, adapter = _dispatcher()
    assert dispatcher.dispatch("backward") is True
    assert adapter.calls == [(-LINEAR_SPEED, 0.0)]


def test_left_is_pure_in_place_rotation():
    dispatcher, adapter = _dispatcher()
    assert dispatcher.dispatch("left") is True
    assert adapter.calls == [(0.0, ANGULAR_SPEED)]


def test_right_is_pure_in_place_rotation_opposite_sign():
    dispatcher, adapter = _dispatcher()
    assert dispatcher.dispatch("right") is True
    assert adapter.calls == [(0.0, -ANGULAR_SPEED)]


def test_stop_zeroes_both_velocities():
    dispatcher, adapter = _dispatcher()
    assert dispatcher.dispatch("stop") is True
    assert adapter.calls == [(0.0, 0.0)]


def test_unknown_command_is_rejected_not_raised():
    dispatcher, adapter = _dispatcher()
    assert dispatcher.dispatch("moonwalk") is False
    assert adapter.calls == []

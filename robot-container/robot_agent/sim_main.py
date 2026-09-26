"""Composition root for a SIMULATED fleet member.

Identical to main.py in every way that reaches the cloud, and different in
exactly two places:

  - ROSAdapter      MockROSAdapter instead of RealROSAdapter. The mock has no
                    ROS2 dependency and synthesises the same shapes the real
                    Turtlebot3 publishes - a 360-reading LDS-01 scan at
                    0.12-3.5 m, odometry, diagnostics, battery. The backend,
                    the registry and the dashboard cannot tell the difference,
                    because at the MQTT boundary there isn't one.
  - VideoStreamer   a null object. A simulated robot has no camera, and
                    pretending otherwise would put a WebRTC offer on the wire
                    that can never be answered.

Why this exists: the point of a fleet console is that it holds more than one
robot, and until now this deployment only ever had one. Running three copies
of the real container is not the way to show that - each one carries ROS2,
Gazebo and GStreamer and wants roughly 2 GB of RAM, so a three-robot fleet
would need more memory than most laptops have spare. This entrypoint runs the
same agent code on ~40 MB, so the extra fleet members are free.

What this deliberately does NOT do is fake anything above the agent. These
robots authenticate to the broker with their own credentials, publish on their
own `robots/{id}/...` topics, are scoped by the same ACL `%u` pattern, and
self-register in Postgres the first time they publish. They are real MQTT
clients that happen to have a simulated body.

    ROBOT_ID=turtlebot3_02 python -m robot_agent.sim_main
"""
import asyncio
import logging
import signal

from robot_agent.agent import RobotCloudAgent
from robot_agent.config import assert_production_safe, load_config
from robot_agent.health_server import HealthServer
from robot_agent.logging_config import configure_logging
from robot_agent.mock_ros_adapter import MockROSAdapter
from robot_agent.mqtt_client import PahoMQTTClient


class NullVideoStreamer:
    """The two methods agent.py calls on a streamer, and nothing else.

    `handle_offer` raises rather than returning a plausible-looking SDP: a
    simulated robot cannot answer a WebRTC offer, and returning something
    malformed would leave the operator's browser waiting on a negotiation
    that will never complete. Failing at the offer is the honest outcome, and
    the backend already surfaces it as a failed offer rather than a hang.
    """

    def __init__(self, logger: logging.Logger) -> None:
        self._logger = logger
        self.frames_dropped = 0

    def start(self) -> None:
        self._logger.info("video: simulated robot, no camera pipeline")

    def stop(self) -> None:
        pass

    def push_frame(self, _frame) -> None:
        # The mock adapter never produces frames, so this should stay at zero.
        self.frames_dropped += 1

    def handle_offer(self, _sdp_text: str) -> str:
        raise RuntimeError(
            "This robot is simulated and has no camera. Video is available on "
            "robots running the full ROS2 container."
        )


async def run() -> None:
    config = load_config()
    assert_production_safe(config)
    configure_logging(config.log_level, config.robot_id)
    logger = logging.getLogger("robot_agent.sim_main")
    logger.info(f"starting SIMULATED fleet member {config.robot_id}")

    mqtt_client = PahoMQTTClient(
        host=config.mqtt.host,
        port=config.mqtt.port,
        username=config.robot_id,  # username IS robot_id - docs/03-mqtt-layer.md
        password=config.mqtt.password,
        client_id=f"{config.robot_id}-agent",
        keepalive=config.mqtt.keepalive,
        tls_enabled=config.mqtt.tls_enabled,
        tls_ca_certs=config.mqtt.tls_ca_certs,
        tls_certfile=config.mqtt.tls_certfile,
        tls_keyfile=config.mqtt.tls_keyfile,
        tls_insecure=config.mqtt.tls_insecure,
    )

    ros_adapter = MockROSAdapter(robot_id=config.robot_id)
    ros_adapter.start()

    video_streamer = NullVideoStreamer(logger)
    video_streamer.start()

    agent = RobotCloudAgent(
        robot_id=config.robot_id,
        mqtt_client=mqtt_client,
        ros_adapter=ros_adapter,
        config=config,
        video_streamer=video_streamer,
    )

    health_server = HealthServer(
        port=config.health_server.port,
        status_provider=agent.get_status,
        metrics_provider=agent.get_metrics,
        auth_token=config.health_server.auth_token,
    )
    health_server.start()

    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop_event.set)

    await agent.connect()
    try:
        await agent.run(stop_event)
    finally:
        await agent.shutdown()
        health_server.stop()
        video_streamer.stop()
        ros_adapter.stop()
        logger.info(f"simulated fleet member {config.robot_id} stopped")


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()

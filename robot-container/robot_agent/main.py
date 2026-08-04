"""Composition root: builds config/logging/adapters, injects them into
RobotCloudAgent, and runs the event loop until SIGTERM/SIGINT.

As of Milestone 5, this injects the real ROS2-backed adapter
(robot_cloud_bridge.real_ros_adapter.RealROSAdapter) instead of
mock_ros_adapter.MockROSAdapter - exactly the one-line-of-intent swap
Milestone 4's docs promised. Nothing in agent.py changed to make this work.

As of Milestone 6, this also constructs VideoStreamer. Milestone 6-8 used a
TEMPORARY DevSignallingServer (a throwaway HTTP endpoint) to negotiate
WebRTC while real signalling didn't exist yet; Milestone 8 deleted it -
signalling is now MQTT-mediated through the backend, handled directly by
RobotCloudAgent (see agent.py's _on_camera_offer) with no separate server
needed on the robot side at all.
See docs/04-robot-agent.md, docs/05-ros2-integration.md,
docs/06-video-streaming.md, docs/08-webrtc-signalling.md.
"""
import asyncio
import logging
import signal

from robot_agent.agent import RobotCloudAgent
from robot_agent.config import load_config
from robot_agent.health_server import HealthServer
from robot_agent.logging_config import configure_logging
from robot_agent.mqtt_client import PahoMQTTClient
from robot_agent.video_streamer import VideoStreamer
from robot_cloud_bridge.real_ros_adapter import RealROSAdapter


async def run() -> None:
    config = load_config()
    configure_logging(config.log_level, config.robot_id)
    logger = logging.getLogger("robot_agent.main")

    mqtt_client = PahoMQTTClient(
        host=config.mqtt.host,
        port=config.mqtt.port,
        username=config.robot_id,  # the robot's MQTT username IS its robot_id - docs/03-mqtt-layer.md
        password=config.mqtt.password,
        client_id=f"{config.robot_id}-agent",
        keepalive=config.mqtt.keepalive,
    )

    ros_adapter = RealROSAdapter(robot_id=config.robot_id)
    ros_adapter.start()

    video_streamer = VideoStreamer(
        bitrate_kbps=config.video.bitrate_kbps,
        framerate=config.video.framerate,
        keyframe_interval=config.video.keyframe_interval,
        stun_server=config.video.stun_server,
        turn_server=config.video.turn_server,
    )
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
        logger.info("Robot Cloud Agent stopped")


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()

"""Agent entrypoint — wires the MQTT client, the publisher and the health
server together, then runs until stopped.

Mirrors robot-container/robot_agent/main.py. The shape to notice: the agent
owns exactly one MQTT connection and passes it to everything that needs to
talk to the broker, rather than each component opening its own.

Run locally (outside Docker):

    cd secure_robotstore/robot-agent
    pip install -r requirements.txt
    MQTT_HOST=localhost MQTT_PORT=1884 python -m agent.main
"""
import asyncio
import contextlib
import logging
import signal

from agent.config import get_settings
from agent.health_server import HealthServer
from agent.mqtt_client import MqttClient
from agent.publisher import Publisher
from agent.topics import cmd_topic

logger = logging.getLogger("agent.main")


async def main() -> None:
    settings = get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-8s %(name)s | %(message)s",
    )

    client = MqttClient(
        host=settings.mqtt_host,
        port=settings.mqtt_port,
        client_id=f"agent-{settings.device_id}",
    )
    publisher = Publisher(client, settings.device_id, settings.publish_interval_seconds)

    async def handle_command(payload: dict) -> None:
        """Southbound commands: cloud -> device.

        Nothing in the UI sends one yet. The subscription is wired anyway so
        the bidirectional shape is visible, and so there is somewhere
        obvious to add the first real command.

        INTERN TASK (security): this acts on whatever arrives. With an
        anonymous broker, ANY client that can reach it can publish here and
        the device will obey. Authentication, an ACL that makes this topic
        write-only for the backend, and payload validation are all missing.
        """
        logger.info(f"command received: {payload!r}")

    client.subscribe(cmd_topic(settings.device_id), handle_command)

    health = HealthServer(
        settings.health_port,
        lambda: {
            "status": "ok",
            "device_id": settings.device_id,
            "mqtt_connected": client.connected,
        },
    )
    health_server = await health.start()

    await client.connect()

    # Stop cleanly on docker stop (SIGTERM) and Ctrl-C (SIGINT) instead of
    # dying mid-publish with a stack trace.
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)

    publish_task = asyncio.create_task(publisher.run())
    logger.info("agent started")

    await stop.wait()
    logger.info("shutting down")

    publish_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await publish_task

    health_server.close()
    await health_server.wait_closed()
    await client.disconnect()
    logger.info("agent stopped")


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(main())

# Simulated fleet member — the same robot_agent package as docker/Dockerfile,
# without ROS2, Gazebo or GStreamer.
#
# The real robot image is multi-gigabyte because it carries a full ROS2 Humble
# desktop and a GStreamer pipeline. A simulated fleet member needs neither: it
# runs robot_agent with MockROSAdapter, whose only dependencies are the two in
# requirements.txt. That is the difference between ~2 GB of RAM per extra
# robot and ~40 MB, which is what makes a three-robot fleet practical on a
# laptop.
#
# Everything the cloud sees is identical — same package, same MQTT client,
# same topics, same auth.
FROM python:3.11-slim

WORKDIR /app

# Requirements first so an agent edit doesn't invalidate the pip layer.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY robot_agent ./robot_agent

# Non-root, matching the hardening applied to the other images in this stack
# (docs/security-findings.md F5).
RUN useradd --create-home --uid 10001 agent && chown -R agent:agent /app
USER agent

EXPOSE 8080

CMD ["python", "-m", "robot_agent.sim_main"]

# Base image is the real target from day one: Ubuntu 22.04 + ROS2 Humble.
# Milestone 5 adds Gazebo + Turtlebot3 packages on top - the base itself
# never changes, exactly as planned back in Milestone 2.
FROM ros:humble-ros-base

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    TURTLEBOT3_MODEL=waffle_pi \
    ROS_WS=/robot/ros_ws \
    # Gazebo's own headless server rendering (world/physics) still wants
    # software GL with no GPU in the container - unrelated to the camera.
    LIBGL_ALWAYS_SOFTWARE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3-pip \
        python3-colcon-common-extensions \
        git \
        mesa-utils \
        libgl1-mesa-dri \
        libglx-mesa0 \
        ros-humble-gazebo-ros-pkgs \
        ros-humble-turtlebot3 \
        ros-humble-turtlebot3-msgs \
        ros-humble-dynamixel-sdk \
        ros-humble-xacro \
        ros-humble-robot-state-publisher \
        # Milestone 6 (respun): a real webcam feeds /camera/image_raw
        # (webcam_driver.py) instead of Gazebo's simulated camera sensor -
        # see docs/06-video-streaming.md for why that sensor was dropped
        # entirely rather than fought with further.
        python3-opencv \
        v4l-utils \
        python3-gi \
        gir1.2-gstreamer-1.0 \
        gir1.2-gst-plugins-base-1.0 \
        gir1.2-gst-plugins-bad-1.0 \
        gstreamer1.0-tools \
        gstreamer1.0-plugins-good \
        gstreamer1.0-plugins-bad \
        gstreamer1.0-plugins-ugly \
        gstreamer1.0-nice \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /robot

COPY requirements.txt ./requirements.txt
RUN pip3 install --no-cache-dir -r requirements.txt

# --- ROS2 workspace ---
# turtlebot3_simulations (worlds + spawn/robot_state_publisher launch files)
# isn't a reliably available apt package for Humble, so it's built from
# source, pinned to a specific branch for reproducibility. Our own bridge
# package is copied in alongside it.
RUN mkdir -p ros_ws/src && \
    git clone --branch humble --depth 1 \
        https://github.com/ROBOTIS-GIT/turtlebot3_simulations.git \
        ros_ws/src/turtlebot3_simulations

COPY ros_ws/src/robot_cloud_bridge ros_ws/src/robot_cloud_bridge

RUN . /opt/ros/humble/setup.sh && \
    cd ros_ws && \
    colcon build --symlink-install --packages-up-to turtlebot3_gazebo robot_cloud_bridge

COPY config ./config
COPY scripts ./scripts
COPY robot_agent ./robot_agent
RUN chmod +x scripts/entrypoint.sh

EXPOSE 8080

# No curl in this base image, so use Python's own stdlib for the check
# rather than adding a package just for a healthcheck.
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s \
    CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8080/health', timeout=3).status == 200 else 1)"

ENTRYPOINT ["scripts/entrypoint.sh"]

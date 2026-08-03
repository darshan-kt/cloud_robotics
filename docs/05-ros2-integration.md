# 05 — ROS2 & Turtlebot3 Integration

## What this step is

`main.py` now injects `RealROSAdapter` instead of `MockROSAdapter`. The container runs a headless Gazebo simulation with a Turtlebot3 `waffle_pi` spawned into it, and the Robot Cloud Agent's commands and telemetry now flow through actual ROS2 topics (`/cmd_vel`, `/odom`) into and out of real physics — not the hand-written kinematic formula `MockROSAdapter` used since Milestone 4.

This is the payoff Milestone 4's whole interface/dependency-injection design was built for, and it's worth pausing on how small the actual change to prove it was: **one file changed in `robot_agent/`** — `main.py`, swapping which concrete class gets constructed. `agent.py`, `dispatcher.py`, every unit test — untouched.

## Why it's needed

### Why headless, by design

Gazebo's 3D GUI (`gzclient`) needs a display. This container will eventually run wherever the real robot's onboard compute runs, or in a cloud simulation farm — neither has a monitor attached. Running only `gzserver` (physics + sensors, no rendering-for-humans) means `docker compose up` stays a single, no-manual-steps command on any host, and it's the same shape this will take in AWS later, where there's no display to forward in the first place. The operator "sees" the robot through the browser's WebRTC video feed once Milestone 6 wires up the camera — not a window on the machine running the simulation. That's not a limitation of this setup; it's the actual product.

### Why `waffle_pi`, not the more common `burger`

Turtlebot3 ships three simulated variants. `burger` is the lightest and most common in tutorials, but it has no camera. `waffle_pi` does. Since this whole platform's second data path is camera → GStreamer → WebRTC → browser, `burger` simply cannot fulfill the spec. Choosing `waffle_pi` now — even though the camera topic isn't consumed until Milestone 6 — means that milestone doesn't need to swap simulation models out from under everything else.

### Why this milestone deliberately narrowed scope

The original plan for this milestone covered wiring all four `ROSAdapter` subscription methods to real data. During planning, that got trimmed to just `publish_cmd_vel` and `subscribe_odometry` — the two that matter for "a real simulated robot actually moves" — for a concrete reason: Turtlebot3's Gazebo stack has no `/battery_state` or `/diagnostics` topics to bridge in the first place. There's no ROS2 data to subscribe to. `RealROSAdapter.subscribe_battery()` and `subscribe_diagnostics()` are honest logged stubs — same pattern `MockROSAdapter` already uses for `subscribe_camera()` — rather than inventing fake numbers now that we've moved past the Mock. `battery_percentage` and the diagnostics fields report `null` in telemetry, and that's correct, not a bug: it reflects what's actually true of this simulated setup. A real Turtlebot3 (or a Gazebo battery plugin, if one gets added later) would have a real topic here; nothing currently does.

### The interface/DI payoff, observed a second time

Recall from Milestone 4: `MockROSAdapter` runs on a background thread and dispatches to whatever callback is currently stored in an instance attribute — it doesn't matter whether `agent.py` registered that callback before or after the thread started, because the thread just checks the attribute on every tick. `RealROSAdapter` uses the *exact same shape*: `subscribe_odometry(callback)` just stores the callback; the real work happens in a `SingleThreadedExecutor` spinning the `rclpy.Node` on its own background thread, and the ROS2 subscription's internal handler (`_handle_odometry`) reads whatever's currently stored and calls it. Two completely different mechanisms underneath (a `time.sleep` loop vs. a DDS-backed ROS2 executor) producing the identical calling contract `agent.py` was written against. That's why zero lines in `agent.py` changed for this milestone — the abstraction held.

### The quaternion-to-yaw conversion

`nav_msgs/Odometry` reports orientation as a quaternion (`x, y, z, w`), not an angle — that's how ROS2 represents 3D rotation without gimbal-lock issues. `OdometryData.heading`, though, is a single float (yaw, rotation about the vertical axis), matching what `MockROSAdapter` already produces. Converting one to the other is a standard, small formula (`atan2(2(wz+xy), 1-2(y²+z²))`) — not worth adding a dependency like `tf_transformations` for one function, so `real_ros_adapter.py` just has it inline.

## What actually broke, and how it got fixed

This section exists because pretending the first build worked perfectly would be dishonest, and the debugging itself is worth understanding — the same spirit as Milestone 3's `mosquitto_passwd` writeup.

**Bug 1 — wrong git branch.** The Dockerfile cloned `turtlebot3_simulations` on branch `humble-devel`, which doesn't exist on that repository (it never did, or was renamed at some point — `git ls-remote` showed the real branch is just `humble`). One-line fix, caught immediately by the build failing fast and clearly.

**Bug 2 — `set -u` vs. ROS2's `setup.bash`.** `entrypoint.sh` used `set -euo pipefail` for safety. ROS2's own `/opt/ros/humble/setup.bash` references its own internal variable (`AMENT_TRACE_SETUP_FILES`) without a default value — completely normal for a script meant to run in an ordinary interactive shell, but fatal under `set -u` ("unbound variable"), causing the container to crash-loop immediately. This is a well-known interaction, not a bug in anything we wrote. Fix: drop `-u`, keep `-e` and `pipefail`.

**Bug 3 — the real one.** With those two fixed, the container ran, but `spawn_entity.py` timed out after 30 seconds with `Service /spawn_entity unavailable. Was Gazebo started with GazeboRosFactory?` — even though the `gzserver` command line clearly showed `-s libgazebo_ros_factory.so` being passed. Investigating live inside the running container (`docker compose exec robot ...`) showed the actual cause: `GAZEBO_PLUGIN_PATH` and `GAZEBO_MODEL_PATH` were both **empty**. `entrypoint.sh` sourced `/opt/ros/humble/setup.bash` (ROS2's environment) and the workspace's own `install/setup.bash` — but never `/usr/share/gazebo/setup.sh`, which is **Gazebo's own environment script**, entirely separate from anything ROS2-flavored, and easy to not know exists if you've only ever worked with the ROS2 side of a ROS2+Gazebo stack. Without it, `gzserver` couldn't resolve the plugin by name. Confirmed by hand (`source /usr/share/gazebo/setup.sh` in a live shell, then re-running the launch — `/spawn_entity` appeared immediately and the robot spawned), then baked permanently into `entrypoint.sh`.

The lesson generalizes: a ROS2+Gazebo stack has *two* environments to source, not one, and only one of them has "ROS" in its name.

## What it does

- **`robot-container/docker/Dockerfile`** — adds `ros-humble-gazebo-ros-pkgs`, `ros-humble-turtlebot3`, `ros-humble-turtlebot3-msgs`, `ros-humble-dynamixel-sdk`, `ros-humble-xacro`, `ros-humble-robot-state-publisher`, `mesa`/software-rendering packages, and `LIBGL_ALWAYS_SOFTWARE=1` (Gazebo's camera sensor plugin renders every tick regardless of subscribers, and needs software rendering with no GPU in the container). Clones `turtlebot3_simulations` (branch `humble`) into `ros_ws/src/` and runs `colcon build` at **image build time**. Final image: 3.81GB (up from 773MB — expected, this is a real simulator, not a rewrite of the base decision from Milestone 2).
- **`robot-container/ros_ws/src/robot_cloud_bridge/`** — new `ament_python` ROS2 package, the only place in the repo that imports `rclpy`:
  - `real_ros_adapter.py` — `RealROSAdapter(ROSAdapter)`, described above.
  - `launch/simulation.launch.py` — self-authored, `gzserver`-only (never includes `gzclient.launch.py` at all, so it's structurally impossible for this to open a GUI, rather than relying on an argument like `gui:=false` threading correctly through someone else's launch file). Reuses `turtlebot3_gazebo`'s own `robot_state_publisher.launch.py` and `spawn_turtlebot3.launch.py` rather than re-implementing URDF/xacro processing by hand.
- **`robot-container/scripts/entrypoint.sh`** — sources ROS2's, the workspace's, *and* Gazebo's own environment scripts; launches the simulation in the background; `exec`s the agent as the container's foreground process. Two long-lived processes in one container is deliberate here, not an oversight: this container represents the robot's entire onboard software stack, the way a real robot's companion computer runs many ROS2 nodes as one integrated system.
- **`robot_agent/main.py`** — the one-line swap: `RealROSAdapter` instead of `MockROSAdapter`.

## Verification

- `docker compose build robot` — succeeds (image: 3.81GB, ~5 min including the `colcon build`)
- Clean `docker compose down && docker compose up -d` from scratch — robot logs show Gazebo spawning `waffle_pi`, then `RealROSAdapter started - publishing /cmd_vel, subscribed to /odom`, no `MockROSAdapter` warning anywhere
- `docker compose exec robot ... ros2 topic list` shows `/cmd_vel` and `/odom` live
- Subscribed to `robots/turtlebot3_01/telemetry` before sending any command: `position` reported `(-1.9999, -0.4999)` — the simulation's actual spawn pose, with tiny physics noise, not `(0, 0)` (which is what the old mock would have shown)
- Published a real `{"command": "forward"}` via MQTT and watched `position.x` move from `-1.9999` to `-1.3502` over ~4 seconds, with `velocity.linear` reading `0.20003886...` — a non-round number is itself the signature of real physics (wheel odometry integration), not the old hand-written formula
- `curl http://localhost:8080/health` / `/metrics` — unaffected, still reporting correctly
- `docker kill -9`'d the robot again — the Last-Will-and-Testament from Milestone 3 still correctly flipped `status` to `offline`, confirming that mechanism survived the adapter swap untouched
- `docker compose down` after verification

## Running it yourself

```bash
docker compose up -d --build
docker compose logs -f robot                  # watch Gazebo spawn + RealROSAdapter connect
docker compose exec robot bash -lc \
  "source /opt/ros/humble/setup.bash && source ros_ws/install/setup.bash && ros2 topic list"

docker exec cloud-robotics-mosquitto mosquitto_pub -h localhost \
  -u backend -P backend_dev_password \
  -t robots/turtlebot3_01/cmd -m '{"command":"forward"}' -q 1

# watch position actually change, driven by real Gazebo physics:
docker exec cloud-robotics-mosquitto mosquitto_sub -h localhost \
  -u backend -P backend_dev_password -t robots/+/telemetry -v

docker compose down
```

**Optional, manual, Linux-only GUI access** (not part of the default flow): if you want to actually *see* the simulation while debugging, you can attach a `gzclient` from the host against the running `gzserver` inside the container by exposing Gazebo's transport port and running `gzclient` locally with `GAZEBO_MASTER_URI` pointed at the container — this needs X11 set up on your host and is genuinely out of scope for `docker compose up`'s no-manual-steps contract, so it isn't wired up here. Worth revisiting only if hands-on visual debugging becomes a recurring need.

Next: [06 — Video Streaming (GStreamer + WebRTC)](06-video-streaming.md) (Milestone 6) finally activates the camera topic on this same `waffle_pi` model and streams it to the browser.

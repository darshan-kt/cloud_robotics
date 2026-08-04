"""Real ROS2 webcam driver node (Milestone 6, respun). Publishes real,
locally-attached webcam frames onto /camera/image_raw as sensor_msgs/Image -
in place of Gazebo's simulated waffle_pi camera sensor. Gazebo keeps driving
physics/cmd_vel/odom exactly as in Milestone 5; only the camera's SOURCE
changes here. This also sidesteps the whole "Gazebo's camera sensor needs a
real render context" struggle documented in docs/06-video-streaming.md
(Bug 1): with nothing left subscribing to it and no Xvfb started, Gazebo's
own CameraSensor just silently disables itself again - its original,
harmless pre-Milestone-6 behavior - freeing /camera/image_raw for this node
to be the one real publisher on it.

This is the only file in the workspace that imports cv2/numpy - kept
separate from real_ros_adapter.py so a machine with no camera hardware can
still build and run the rest of the stack.

RealROSAdapter.subscribe_camera() doesn't care who publishes
/camera/image_raw or what the frames actually show - VideoStreamer builds
its GStreamer pipeline lazily from whatever width/height/encoding the first
real CameraFrame reports (see video_streamer.py) - so this node requires
zero changes anywhere else in the pipeline.
"""
import os
import time
from typing import Optional

import cv2
import numpy as np
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image

_REOPEN_INTERVAL_SECONDS = 5.0


class WebcamDriver(Node):
    def __init__(self) -> None:
        super().__init__("webcam_driver")

        self._device = os.environ.get("CAMERA_DEVICE", "/dev/video0")
        self._width = int(os.environ.get("CAMERA_WIDTH", "640"))
        self._height = int(os.environ.get("CAMERA_HEIGHT", "480"))
        self._fps = float(os.environ.get("CAMERA_FPS", "15"))
        # OFF by default, deliberately: a real deployment where the camera
        # fails to open should fail LOUDLY (repeated warnings, zero frames
        # published) rather than silently swap in fake video. This is only
        # for dev/CI boxes with no webcam hardware at all - see
        # docs/06-video-streaming.md.
        self._test_pattern_fallback = os.environ.get(
            "CAMERA_TEST_PATTERN_FALLBACK", "false"
        ).strip().lower() in ("1", "true", "yes")

        self._publisher = self.create_publisher(Image, "/camera/image_raw", 1)
        self._cap: Optional[cv2.VideoCapture] = None
        self._frames_published = 0
        self._last_open_attempt = 0.0
        self._synthetic_hue = 0

        self._try_open_device()
        self.create_timer(1.0 / self._fps, self._on_timer)

        self.get_logger().info(
            f"WebcamDriver publishing /camera/image_raw from '{self._device}' "
            f"at ~{self._fps}fps (test_pattern_fallback={self._test_pattern_fallback})"
        )

    def _try_open_device(self) -> bool:
        self._last_open_attempt = time.monotonic()
        cap = cv2.VideoCapture(self._device, cv2.CAP_V4L2)
        if not cap.isOpened():
            cap.release()
            self._cap = None
            return False

        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)
        cap.set(cv2.CAP_PROP_FPS, self._fps)
        self._cap = cap
        self.get_logger().info(f"Opened real camera device '{self._device}'")
        return True

    def _on_timer(self) -> None:
        if self._cap is None:
            # Retry periodically rather than crash-looping the whole
            # container over a camera that's plugged in late or missing.
            if time.monotonic() - self._last_open_attempt > _REOPEN_INTERVAL_SECONDS:
                self._try_open_device()
            if self._cap is None:
                self.get_logger().warning(
                    f"No camera at '{self._device}' - retrying every "
                    f"{_REOPEN_INTERVAL_SECONDS:.0f}s"
                    + (" (publishing SYNTHETIC test-pattern frames meanwhile)" if self._test_pattern_fallback else ""),
                    throttle_duration_sec=_REOPEN_INTERVAL_SECONDS,
                )
                if self._test_pattern_fallback:
                    self._publish_bgr(self._synthetic_frame())
                return

        ok, frame = self._cap.read()
        if not ok:
            self.get_logger().warning(
                "Camera read() failed - device may have been unplugged; will retry opening it",
                throttle_duration_sec=_REOPEN_INTERVAL_SECONDS,
            )
            self._cap.release()
            self._cap = None
            return

        self._publish_bgr(frame)

    def _publish_bgr(self, frame: np.ndarray) -> None:
        height, width = frame.shape[:2]
        msg = Image()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = "camera_rgb_optical_frame"
        msg.height = height
        msg.width = width
        msg.encoding = "bgr8"  # OpenCV's native channel order
        msg.is_bigendian = 0
        msg.step = width * 3
        msg.data = np.ascontiguousarray(frame).tobytes()
        self._publisher.publish(msg)
        self._frames_published += 1

    def _synthetic_frame(self) -> np.ndarray:
        """CLEARLY-labeled dev/test stand-in for CAMERA_TEST_PATTERN_FALLBACK
        - an animated color sweep with an on-frame label, not a still image,
        so it's obvious in the actual video feed that this isn't a real
        camera. See the module docstring for why this defaults to off."""
        self._synthetic_hue = (self._synthetic_hue + 2) % 180
        hsv = np.full((self._height, self._width, 3), 255, dtype=np.uint8)
        hsv[:, :, 0] = self._synthetic_hue
        frame = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
        cv2.putText(
            frame,
            "NO CAMERA - SYNTHETIC TEST PATTERN",
            (10, self._height - 20),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        return frame

    def destroy_node(self) -> bool:
        if self._cap is not None:
            self._cap.release()
        return super().destroy_node()


def main(args=None) -> None:
    rclpy.init(args=args)
    node = WebcamDriver()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()

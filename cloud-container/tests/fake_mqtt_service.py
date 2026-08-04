"""In-memory MQTTService test double - no live broker needed."""


class FakeMQTTService:
    def __init__(self):
        self.published: list[tuple[str, str]] = []
        self.camera_offers: list[tuple[str, str, str]] = []  # (robot_id, request_id, sdp)
        self.is_connected = True

    def publish_command(self, robot_id: str, command: str) -> None:
        self.published.append((robot_id, command))

    def publish_camera_offer(self, robot_id: str, request_id: str, sdp: str) -> None:
        self.camera_offers.append((robot_id, request_id, sdp))

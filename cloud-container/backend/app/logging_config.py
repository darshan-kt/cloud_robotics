"""Structured JSON logging, shared by every backend module.

Every log line is a single JSON object with timestamp, module, severity, and
message - the same shape used across every service in this platform (robot
agent included). A robot_id field is added by modules that log about a
specific robot, once those modules exist (Milestone 7+).
"""
import json
import logging
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "module": record.name,
            "severity": record.levelname,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # uvicorn's access log is noisy at INFO and duplicates what our own
    # request logging will do once it exists - keep it to warnings only.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

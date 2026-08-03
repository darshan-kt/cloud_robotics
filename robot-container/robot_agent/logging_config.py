"""Structured JSON logging - same shape as cloud-container/backend/app/
logging_config.py (timestamp, module, severity, message), plus robot_id
since every log line here is about one specific robot.
"""
import json
import logging
import sys
from datetime import datetime, timezone


def configure_logging(level: str, robot_id: str) -> None:
    class JsonFormatter(logging.Formatter):
        def format(self, record: logging.LogRecord) -> str:
            payload = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "module": record.name,
                "robot_id": robot_id,
                "severity": record.levelname,
                "message": record.getMessage(),
            }
            if record.exc_info:
                payload["exception"] = self.formatException(record.exc_info)
            return json.dumps(payload)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

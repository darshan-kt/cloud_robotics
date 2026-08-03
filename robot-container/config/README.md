# robot-container/config/

**Purpose:** all robot-side configuration as YAML, so nothing is hardcoded — robot ID, MQTT broker address/port, MQTT topic prefixes, video bitrate, heartbeat interval, and reconnect/backoff settings.

**Why YAML, not hardcoded values:** the same agent code must run against `localhost` today and an AWS IoT Core endpoint later. Every environment-specific value lives here (with environment-variable overrides for secrets/deployment-specific values), never inline in Python.

**Will contain:** `default.yaml` (base config) plus environment overlays (e.g. `local.yaml`), loaded by the agent's configuration loader.

**Filled in:** Milestone 2 (initial structure), consumed starting Milestone 4.

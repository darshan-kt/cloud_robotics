# cloud-container/config/

**Purpose:** all cloud-side configuration as YAML — service ports, MQTT broker address, database URL, Redis address, JWT settings, CORS origins. No hardcoded addresses anywhere in application code.

**Will contain:** `default.yaml` plus environment overlays, loaded by the backend's configuration module. The only thing that should differ between local and AWS deployment is *which* config values are set, never the code that reads them.

**Filled in:** Milestone 2 (initial structure), consumed starting Milestone 7.

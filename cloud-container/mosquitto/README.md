# cloud-container/mosquitto/

**Purpose:** configuration for the Eclipse Mosquitto MQTT broker — the single channel through which the cloud backend and every robot communicate.

**Will contain:** `mosquitto.conf` (listeners, persistence), authentication (password file or plugin), and ACLs scoping each robot's credentials to its own `robots/{robot_id}/...` topic namespace only.

**AWS note:** this maps directly to AWS IoT Core in production (see [`docs/00-overview.md`](../../docs/00-overview.md)) — the topic design and ACL model are built to translate directly to IoT Core policies, not just to work locally.

**Filled in:** Milestone 3.

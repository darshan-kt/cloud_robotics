# cloud-container/tests/

**Purpose:** tests for the cloud-container codebase.

**Will contain:**
- Backend unit tests (business logic, isolated from MQTT/DB/Redis via dependency injection)
- API integration tests (REST + WebSocket endpoints, against a test database)
- MQTT integration tests (backend ↔ broker, using a real Mosquitto test instance)

**Filled in:** Milestone 7 onward, expanded in Milestone 10.

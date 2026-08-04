# scripts/

**Purpose:** repo-wide developer tooling that spans both containers - as opposed to `robot-container/scripts/`, which holds scripts that ship *inside* the robot image (its entrypoint, etc.).

**Contains:**
- `run-integration-tests.sh` (Milestone 10) — runs the full three-container test suite (robot unit tests, backend unit + live tests, real-browser frontend E2E tests) against a live `docker compose` stack in one command. See [`docs/10-testing-strategy.md`](../docs/10-testing-strategy.md).

**Filled in:** Milestone 10.

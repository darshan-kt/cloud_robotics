#!/bin/bash
# Runs the full three-container test suite in one command: robot_agent
# unit tests (inside the real robot container), the cloud-container suite
# (backend unit + live integration + the real-browser frontend E2E tests),
# all against a live docker compose stack. See docs/10-testing-strategy.md
# for why "one command, real stack, real browser" is the point of this
# milestone, not just a convenience wrapper.
#
# Usage:
#   ./scripts/run-integration-tests.sh              # stack must already be up
#   ./scripts/run-integration-tests.sh --up          # also bring the stack up first
#   ./scripts/run-integration-tests.sh --up --down   # ...and tear it down after
set -uo pipefail
cd "$(dirname "$0")/.."

# Load .env so the live tests authenticate with the SAME credentials the
# running stack was started with. Without this they fall back to the
# built-in defaults ("operator"/"operator_dev_password"), which fail
# against any deployment that changed them - and since Milestone 12 those
# repeated failures also trip the login brute-force lockout, turning a
# credential mismatch into a confusing wall of HTTP 429s.
# `set -a` exports every variable the file defines; the subshell-safe
# grep filter skips comments and blank lines.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

BRING_UP=false
TEAR_DOWN=false
for arg in "$@"; do
  case "$arg" in
    --up) BRING_UP=true ;;
    --down) TEAR_DOWN=true ;;
    *) echo "Unknown argument: $arg (expected --up and/or --down)" >&2; exit 1 ;;
  esac
done

if [ "$BRING_UP" = true ]; then
  echo "==> Bringing up the full stack (docker compose up -d --build)..."
  docker compose up -d --build
  echo "==> Waiting for backend and robot health checks..."
  until curl -sf http://localhost:8000/health >/dev/null 2>&1; do sleep 1; done
  until curl -sf http://localhost:8080/health >/dev/null 2>&1; do sleep 1; done
fi

FAILED=0

echo
echo "=== Robot-side tests (robot_agent, real Turtlebot3/GStreamer container) ==="
# Test code and pytest.ini are deliberately NOT baked into the production
# robot image (see robot-container/tests/requirements.txt's own header) -
# copied in here for the duration of this run only, into a container that
# already exists (docker compose up -d must have created it).
if docker cp robot-container/tests cloud-robotics-robot:/robot/tests 2>/dev/null \
  && docker cp robot-container/pytest.ini cloud-robotics-robot:/robot/pytest.ini 2>/dev/null; then
  # -u root: the agent runs unprivileged (docs/security-findings.md F5), but
  # `docker cp` lands these files root-owned and pytest writes .pytest_cache
  # beside them. The test path running as root exercises the same code.
  docker compose exec -T -u root robot bash -c \
    "pip install -q -r /robot/tests/requirements.txt && cd /robot && python3 -m pytest tests/ -v" \
    || FAILED=1
else
  echo "SKIPPED - robot container not running (bring the stack up first, or pass --up)"
fi

echo
echo "=== Cloud-side tests (backend unit + live integration + real-browser frontend E2E) ==="
python3 -m pytest cloud-container/tests/ -v || FAILED=1

if [ "$TEAR_DOWN" = true ]; then
  echo
  echo "==> Tearing down the stack (docker compose down)..."
  docker compose down
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "=== ALL SUITES PASSED ==="
else
  echo "=== ONE OR MORE SUITES FAILED - see output above ==="
fi
exit "$FAILED"

# Cloud Robotics Platform - developer entry points.
#
# This is a thin, documented wrapper around `docker compose` and the
# scripts/test suites already in this repo (see README.md and
# docs/10-testing-strategy.md) - it doesn't do anything you couldn't do by
# hand, it just gives every one of those commands a short, memorable name.
#
# Run `make` (or `make help`) with no target to see this list.

# -include, not include: don't fail if .env doesn't exist yet (that's
# exactly what `make setup` is for). Deliberately NOT `export`-ed: `docker
# compose` already reads .env on its own for every value it needs, so
# re-exporting Make's own copy of it would just add a second, competing
# source - and a real one at that: Make variables shadow same-named
# environment variables in recipes once exported, which would silently
# defeat something like `CAMERA_TEST_PATTERN_FALLBACK=true make
# restart-robot` (a real thing `make restart-robot`'s own help text
# recommends - see README.md). Pulling `.env` in here unexported is only
# for THIS Makefile's own $(VAR) text substitution below (health/token/
# open messages) - it never touches what a recipe's child process actually
# sees in its environment.
-include .env

BACKEND_PORT ?= 8000
FRONTEND_PORT ?= 3000
ROBOT_HEALTH_PORT ?= 8080
OPERATOR_USERNAME ?= operator
OPERATOR_PASSWORD ?= operator_dev_password
ROBOSTORE_PORT ?= 3100
ROBOSTORE_PROD_PORT ?= 3101
# ROBOSTORE's auth is a stub (robostore-poc/src/hooks/useAuth.ts) - ANY email
# + a 6-digit-or-longer password signs in. These are just the example pair
# printed below and in README.md, not a real, enforced credential - there's
# nothing to configure or rotate here, unlike OPERATOR_USERNAME/PASSWORD above.
ROBOSTORE_EMAIL ?= operator@robot.local
ROBOSTORE_DEMO_PASSWORD ?= 123456

.DEFAULT_GOAL := help
.PHONY: help setup build up up-test-pattern up-camera gzclient down restart restart-robot \
        ps status logs health token open test test-robot test-cloud clean prune _wait-healthy _xhost \
        robostore-build robostore-up robostore-up-prod robostore-down robostore-ps robostore-logs \
        robostore-open _robostore-wait

help: ## Show this help
	@echo "Cloud Robotics Platform - available targets:"
	@echo
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' Makefile | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

## --- Setup & build ---

setup: ## Create .env from .env.example if it doesn't exist yet
	@test -f .env || cp .env.example .env
	@echo ".env ready - edit it if you need non-default credentials/ports (see .env.example's own comments)."

build: setup ## Build all Docker images (backend, frontend, robot)
	docker compose build

## --- Running the stack ---

up: setup _xhost ## Start the full stack (7 services). Gazebo's GUI opens automatically if DISPLAY is set (see README.md); no real webcam feed unless you also use `make up-camera` or `make up-test-pattern`.
	docker compose up -d --build
	@$(MAKE) --no-print-directory _wait-healthy
	@echo
	@echo "Stack is up:"
	@echo "  Console:  http://localhost:$(FRONTEND_PORT)  (login: $(OPERATOR_USERNAME) / $(OPERATOR_PASSWORD))"
	@echo "  Backend:  http://localhost:$(BACKEND_PORT)/health"
	@echo "  Robot:    http://localhost:$(ROBOT_HEALTH_PORT)/health"

up-test-pattern: setup _xhost ## Start the stack with a SYNTHETIC camera pattern (no physical webcam needed) - see docs/06-video-streaming.md
	CAMERA_TEST_PATTERN_FALLBACK=true docker compose up -d --build
	@$(MAKE) --no-print-directory _wait-healthy
	@echo "Stack is up with a synthetic test-pattern camera feed. Console: http://localhost:$(FRONTEND_PORT)"

up-camera: setup _xhost ## Start the stack with your REAL webcam passed through (requires CAMERA_DEVICE in .env, default /dev/video0) - see docker-compose.camera.yml
	docker compose -f docker-compose.yml -f docker-compose.camera.yml up -d --build
	@$(MAKE) --no-print-directory _wait-healthy
	@echo "Stack is up with a real webcam feed. Console: http://localhost:$(FRONTEND_PORT)"

gzclient: ## Re-open Gazebo's GUI window by hand (it already opens automatically on `make up`/`docker compose up` if DISPLAY is set - this is only for reattaching after closing it)
	docker exec -it cloud-robotics-robot gzclient

_wait-healthy:
	@echo "Waiting for backend + robot health checks..."
	@until curl -sf http://localhost:$(BACKEND_PORT)/health >/dev/null 2>&1; do sleep 1; done
	@until curl -sf http://localhost:$(ROBOT_HEALTH_PORT)/health >/dev/null 2>&1; do sleep 1; done

# Grants local Docker containers access to the host's X server, so the
# robot container's auto-launched gzclient can actually open a window -
# see docker-compose.yml's robot service and simulation.launch.py. Best-
# effort and silent: on a host with no X server (or no `xhost` binary -
# e.g. Windows/macOS Docker Desktop, a headless server) this is a no-op,
# never a failure - DISPLAY simply won't be set either, and the launch
# file already runs headless in that case regardless of this step.
_xhost:
	@command -v xhost >/dev/null 2>&1 && xhost +local:docker >/dev/null 2>&1 || true

down: ## Stop the stack (keeps volumes - Postgres/Redis/Mosquitto data survives)
	docker compose down

restart: down up ## Stop and start the full stack

restart-robot: ## Recreate just the robot container (e.g. after editing .env) without restarting everything else
	docker compose up -d --no-deps robot

## --- Inspecting the running stack ---

ps: ## Show container status
	docker compose ps

status: ps ## Alias for `ps`

logs: ## Tail logs - all services, or one: `make logs SERVICE=robot`
	docker compose logs -f $(SERVICE)

health: ## Curl the backend, robot, and frontend health endpoints
	@printf "Backend:  " && curl -sf http://localhost:$(BACKEND_PORT)/health && echo
	@printf "Robot:    " && curl -sf http://localhost:$(ROBOT_HEALTH_PORT)/health && echo
	@printf "Frontend: " && curl -sf -o /dev/null -w "HTTP %{http_code}\n" http://localhost:$(FRONTEND_PORT)/

token: ## Fetch a fresh operator JWT and print it (handy for `curl -H "Authorization: Bearer $$(make -s token)"`)
	@curl -s -X POST http://localhost:$(BACKEND_PORT)/auth/login \
		-H 'Content-Type: application/json' \
		-d '{"username":"$(OPERATOR_USERNAME)","password":"$(OPERATOR_PASSWORD)"}' \
		| python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])"

open: ## Open the operator console in your default browser
	@xdg-open http://localhost:$(FRONTEND_PORT) 2>/dev/null \
		|| open http://localhost:$(FRONTEND_PORT) 2>/dev/null \
		|| echo "Open http://localhost:$(FRONTEND_PORT) manually"

## --- Testing (see docs/10-testing-strategy.md) ---

test: ## Run the FULL three-container integration suite (robot + backend + real-browser frontend E2E) - 80 tests, one command
	./scripts/run-integration-tests.sh

test-robot: ## Run only the robot_agent unit tests, inside the live robot container
	docker cp robot-container/tests cloud-robotics-robot:/robot/tests
	docker cp robot-container/pytest.ini cloud-robotics-robot:/robot/pytest.ini
	docker compose exec robot bash -c "pip install -q -r /robot/tests/requirements.txt && cd /robot && python3 -m pytest tests/ -v"

test-cloud: ## Run only the backend + real-browser frontend E2E tests, on the host, against the live stack
	pip install -q -r cloud-container/tests/requirements.txt
	pytest cloud-container/tests/ -v

## --- ROBOSTORE (robostore-poc/, demo app-store console, POC) ---
## Entirely separate from the stack above - its own compose file
## (docker-compose.robostore.yml), own Compose project, own containers.
## The main stack does NOT need to be running for any of these. See
## robostore-poc/README.md.

robostore-build: ## Build the ROBOSTORE dev image
	docker compose -f docker-compose.robostore.yml build robostore

robostore-up: robostore-build ## Start ROBOSTORE standalone (Vite dev server), independent of the main stack
	docker compose -f docker-compose.robostore.yml up -d --build robostore
	@$(MAKE) --no-print-directory _robostore-wait
	@echo "ROBOSTORE is up: http://localhost:$(ROBOSTORE_PORT)  (login: $(ROBOSTORE_EMAIL) / $(ROBOSTORE_DEMO_PASSWORD) - or any email + 6-digit password)"

robostore-up-prod: ## Start ROBOSTORE's compiled nginx build (proves the prod target works), on a separate port from the dev target
	docker compose -f docker-compose.robostore.yml --profile prod up -d --build robostore-prod
	@echo "ROBOSTORE (prod build) is up: http://localhost:$(ROBOSTORE_PROD_PORT)  (login: $(ROBOSTORE_EMAIL) / $(ROBOSTORE_DEMO_PASSWORD) - or any email + 6-digit password)"

_robostore-wait:
	@echo "Waiting for ROBOSTORE's dev server..."
	@until curl -sf http://localhost:$(ROBOSTORE_PORT)/ >/dev/null 2>&1; do sleep 1; done

robostore-down: ## Stop ROBOSTORE (both the dev and prod-profile containers, if running)
	docker compose -f docker-compose.robostore.yml --profile prod down

robostore-ps: ## Show ROBOSTORE container status
	docker compose -f docker-compose.robostore.yml --profile prod ps

robostore-logs: ## Tail ROBOSTORE's logs
	docker compose -f docker-compose.robostore.yml logs -f robostore

robostore-open: ## Open ROBOSTORE in your default browser
	@xdg-open http://localhost:$(ROBOSTORE_PORT) 2>/dev/null \
		|| open http://localhost:$(ROBOSTORE_PORT) 2>/dev/null \
		|| echo "Open http://localhost:$(ROBOSTORE_PORT) manually"

## --- Cleanup ---

clean: ## Stop the stack AND remove volumes (deletes all Postgres/Redis/Mosquitto data)
	docker compose down -v

prune: ## Reclaim disk space (dangling images, unused build cache) - safe, doesn't touch running containers
	docker image prune -f
	docker builder prune -f

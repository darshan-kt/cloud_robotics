# secure_robotstore — a deliberately insecure training mirror of the main
# cloud-robotics stack. See README.md.

.DEFAULT_GOAL := help
COMPOSE := docker compose

.PHONY: help up down restart logs ps health build clean verify-holes psql redis-cli

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

up: ## Build and start the whole stack
	$(COMPOSE) up -d --build
	@echo "frontend  http://localhost:3001   (operator / demo1234)"
	@echo "backend   http://localhost:8001/docs"

down: ## Stop everything and remove volumes
	$(COMPOSE) down -v

restart: ## Restart every service
	$(COMPOSE) restart

build: ## Rebuild images without starting
	$(COMPOSE) build

logs: ## Tail logs from all services
	$(COMPOSE) logs -f

ps: ## Show service status
	$(COMPOSE) ps

health: ## Print the backend's dependency health
	@curl -s localhost:8001/health/detail | python3 -m json.tool

psql: ## Open a psql shell
	docker exec -it sr-postgres psql -U robotstore -d robotstore

redis-cli: ## Open a redis-cli shell
	docker exec -it sr-redis redis-cli

verify-holes: ## Demonstrate the three headline vulnerabilities
	@echo "--- 1. forge a reading with no credentials ---"
	@docker run --rm --network secure-robotstore_secure-robotstore-net eclipse-mosquitto:2 \
		mosquitto_pub -h mosquitto -p 1883 -t devices/demo-device-01/int \
		-m '{"value":999,"seq":999999}' && echo "    published anonymously"
	@sleep 1
	@docker exec sr-postgres psql -U robotstore -d robotstore -t \
		-c "SELECT '    persisted: seq=' || seq || ' value=' || value FROM int_readings WHERE seq = 999999 LIMIT 1;"
	@echo "--- 2. read all broker traffic, unauthenticated ---"
	@timeout 2 docker run --rm --network secure-robotstore_secure-robotstore-net eclipse-mosquitto:2 \
		mosquitto_sub -h mosquitto -p 1883 -t 'devices/#' -v 2>/dev/null | head -2 || true
	@echo "--- 3. unauthenticated API read ---"
	@curl -s -o /dev/null -w "    GET /api/string/history -> HTTP %{http_code}\n" localhost:8001/api/string/history

clean: down ## Alias for down

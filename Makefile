# NEE Production Platform - developer Makefile
# Run from repo root. Targets:
#   make up         start postgres + mailpit (background)
#   make down       stop docker services
#   make seed       reload seed data into running postgres
#   make reset      destroy and recreate the database from scratch
#   make api        run the .NET API (foreground, hot reload)
#   make web        run the Angular dev server (foreground)
#   make dev        run api + web together (requires GNU make + 2 terminals OR concurrently)
#   make test       run all tests
#   make hash-pw    re-hash the seed users' passwords via the dev endpoint

.PHONY: up down seed reset api web dev test install hash-pw verify clean demo

# ----- Infrastructure -----
up:
	cd db && docker compose up -d
	@echo "Waiting for Postgres to be ready..."
	@for i in 1 2 3 4 5 6 7 8 9 10; do \
		if docker exec nee-postgres pg_isready -U nee -d nee >/dev/null 2>&1; then \
			echo "Postgres is up"; exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "Postgres did not become ready in 10s"; exit 1

down:
	cd db && docker compose down

seed:
	@echo "Loading seed data..."
	docker exec -i nee-postgres psql -U nee -d nee < db/migrations/002_seed_data.sql
	@echo "Seed loaded. Run 'make hash-pw' next to set the dev passwords."

demo:
	@echo "Loading demo production data (RO99001-RO99006)..."
	docker exec -i nee-postgres psql -U nee -d nee < db/seeds/demo_production.sql
	@echo "Demo data loaded."

reset:
	@echo "Resetting database (this destroys all data)..."
	cd db && docker compose down -v
	cd db && docker compose up -d
	@echo "Waiting for fresh DB to initialise..."
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12; do \
		if docker exec nee-postgres pg_isready -U nee -d nee >/dev/null 2>&1; then \
			break; \
		fi; \
		sleep 1; \
	done
	@echo "Schema (001) auto-applied via Docker init. Loading seeds..."
	@sleep 2
	docker exec -i nee-postgres psql -U nee -d nee < db/migrations/002_seed_data.sql
	docker exec -i nee-postgres psql -U nee -d nee < db/migrations/003_ro_number_seq.sql
	docker exec -i nee-postgres psql -U nee -d nee < db/migrations/004_e4_station_owner_seed.sql
	@echo "Database reset complete. Don't forget: 'make hash-pw' once the API is running."

# ----- Application -----
install:
	cd api && dotnet restore
	cd web && npm install

api:
	cd api && dotnet run

web:
	cd web && npm start

dev:
	@command -v concurrently >/dev/null 2>&1 || npm install -g concurrently
	concurrently --names "API,WEB" --prefix-colors "blue,green" \
		"cd api && dotnet run" \
		"cd web && npm start"

# ----- Tests -----
test:
	dotnet test Nee.sln
	cd web && npm test -- --watch=false --browsers=ChromeHeadless

# ----- Utility -----
# Re-hash the seed users' passwords using the dev endpoint. Requires API running.
hash-pw:
	@echo "Hashing seed passwords via /api/dev/reseed-passwords..."
	@curl -s -X POST http://localhost:5000/api/dev/reseed-passwords && echo ""

# Smoke check that everything is reachable and seed is in place.
verify:
	@echo "Postgres health:"
	@docker exec nee-postgres pg_isready -U nee -d nee || (echo "  Postgres not reachable"; exit 1)
	@echo "Template count:"
	@docker exec nee-postgres psql -U nee -d nee -t -c "SELECT count(*) FROM job_code_templates;"
	@echo "User count:"
	@docker exec nee-postgres psql -U nee -d nee -t -c "SELECT count(*) FROM users;"
	@echo "API health (requires 'make api' running in another terminal):"
	@curl -s http://localhost:5000/api/health | head -c 200 && echo ""

clean:
	rm -rf api/bin api/obj
	rm -rf web/node_modules web/dist

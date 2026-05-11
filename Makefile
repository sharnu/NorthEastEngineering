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

.PHONY: up down seed reset api web dev test install hash-pw verify clean demo \
        deploy deploy-bootstrap deploy-logs deploy-reset deploy-ssh \
        deploy-aca-init deploy-aca deploy-aca-logs deploy-aca-url

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
	docker exec -i nee-postgres psql -U nee -d nee < db/seeds/update_ro_chassis_fields.sql
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

# ----- Deployment (Azure VM) -----
# Set NEE_VM=user@host  (e.g. azureuser@20.213.45.67) before running any of these.
# Optional: NEE_REMOTE=/opt/nee  (defaults to /opt/nee on the VM)

# One-shot setup on a fresh Ubuntu 22.04 VM — installs Docker, .NET, nginx,
# swap, systemd unit. Run once; safe to re-run.
deploy-bootstrap:
	@test -n "$$NEE_VM" || (echo "Set NEE_VM=user@host first"; exit 1)
	scp infra/vm-bootstrap.sh "$$NEE_VM":~/vm-bootstrap.sh
	ssh "$$NEE_VM" 'bash ~/vm-bootstrap.sh'
	@echo "VM bootstrapped. Now: make deploy"

# Build locally, rsync to VM, restart the API service. Use this for routine
# code deploys after the bootstrap.
deploy:
	@test -n "$$NEE_VM" || (echo "Set NEE_VM=user@host first"; exit 1)
	bash infra/deploy.sh

# Tail the API logs on the VM.
deploy-logs:
	@test -n "$$NEE_VM" || (echo "Set NEE_VM=user@host first"; exit 1)
	ssh -t "$$NEE_VM" 'sudo journalctl -u nee-api -f --output=cat'

# Wipe and rebuild the demo database on the VM, then hash passwords.
# Destroys all data — confirm before running.
deploy-reset:
	@test -n "$$NEE_VM" || (echo "Set NEE_VM=user@host first"; exit 1)
	@echo "About to destroy the remote database on $$NEE_VM. Ctrl-C to abort."
	@sleep 3
	ssh "$$NEE_VM" 'set -e; \
		cd /opt/nee && docker compose down -v && docker compose up -d; \
		echo "Waiting for Postgres..."; \
		for i in 1 2 3 4 5 6 7 8 9 10 11 12; do \
			if docker exec nee-postgres pg_isready -U nee -d nee >/dev/null 2>&1; then break; fi; \
			sleep 1; \
		done; \
		sudo systemctl restart nee-api; \
		sleep 3; \
		curl -fsS -X POST http://localhost/api/dev/reseed-passwords && echo'

# Shortcut to SSH into the VM.
deploy-ssh:
	@test -n "$$NEE_VM" || (echo "Set NEE_VM=user@host first"; exit 1)
	ssh "$$NEE_VM"

# ----- Deployment (Azure Container Apps — self-resetting demo) -----
# Set NEE_IMAGE=<registry>/<repo> (e.g. ghcr.io/sharnu/nee) before running.
# Optional: NEE_RG, NEE_LOCATION, NEE_APP, NEE_ENV. See infra/deploy-aca.sh.

# First-time setup: creates resource group + Container Apps environment + app,
# generates a JWT secret. Idempotent on the RG/env, opinionated on the app.
deploy-aca-init:
	@test -n "$$NEE_IMAGE" || (echo "Set NEE_IMAGE=<registry>/<repo> first"; exit 1)
	ACTION=init bash infra/deploy-aca.sh

# Routine deploy: builds image, pushes, updates the container app with a new revision.
deploy-aca:
	@test -n "$$NEE_IMAGE" || (echo "Set NEE_IMAGE=<registry>/<repo> first"; exit 1)
	bash infra/deploy-aca.sh

# Tail the container's stdout/stderr (entrypoint + API + nginx access log).
deploy-aca-logs:
	az containerapp logs show -n $${NEE_APP:-nee} -g $${NEE_RG:-nee-rg} --follow --tail 100

# Print the app's public URL.
deploy-aca-url:
	@az containerapp show -n $${NEE_APP:-nee} -g $${NEE_RG:-nee-rg} \
		--query properties.configuration.ingress.fqdn -o tsv \
		| sed 's|^|https://|'

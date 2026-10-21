# Music Room - every dependency is downloaded from the registries, nothing is vendored.
# On Windows without make, the same commands exist as npm scripts in package.json.

all: install

install:
	cd backend && npm ci
	cd mobile && npm ci

# Local PostgreSQL without Docker (embedded binaries, data in .pgdata/). Keeps running.
db:
	cd backend && npm run db:local

# Alternative: PostgreSQL in Docker
db-docker:
	docker compose up -d db

migrate:
	cd backend && npx prisma migrate deploy

dev:
	cd backend && npm run dev

mobile:
	cd mobile && npx expo start

android:
	cd mobile && npx expo run:android

test:
	cd backend && npm test

lint:
	cd backend && npm run typecheck
	cd mobile && npx tsc --noEmit && npx expo lint

build:
	cd backend && npm run build

docs:
	cd backend && npm run docs:openapi

# Start the API with TRACK_CATALOG=fake and a high RATE_LIMIT_MAX first (see docs/RAMPUP.md)
load:
	cd backend && npm run load

clean:
	rm -rf backend/dist backend/coverage mobile/dist mobile/.expo

fclean: clean
	rm -rf backend/node_modules mobile/node_modules

re: fclean all

.PHONY: all install db db-docker migrate dev mobile android test lint build docs load clean fclean re

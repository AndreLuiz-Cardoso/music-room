# Every dependency comes from the registries; on Windows, package.json has the same commands.

all: install

install:
	cd backend && npm ci
	cd mobile && npm ci

# Local PostgreSQL without Docker (embedded binaries, data in .pgdata/). Keeps running.
db:
	cd backend && npm run db:local

# Alternative: PostgreSQL in Docker
db-docker:
	cd backend && npm run db:docker

# Local inbox: catches every email the API sends (SMTP localhost:1025), read at http://localhost:1080
mail:
	cd backend && npm run mail:local

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

# Needs `make dev` and `make mobile` running (see README): e2e opens the Playwright UI, e2e-cli the terminal
e2e: e2e-deps
	cd e2e && npm run checks:ui

e2e-cli: e2e-deps
	cd e2e && npm run checks

e2e-deps:
	cd e2e && npm ci && npx playwright install chromium

clean:
	rm -rf backend/dist backend/coverage mobile/dist mobile/.expo

fclean: clean
	rm -rf backend/node_modules mobile/node_modules e2e/node_modules

re: fclean all

.PHONY: all install db db-docker mail migrate dev mobile android test lint build docs load e2e e2e-cli e2e-deps clean fclean re

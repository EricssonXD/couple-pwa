#!/usr/bin/env bash
# scripts/dev-bootstrap.sh
#
# One-shot dev environment bootstrap:
#   1. Verify .env exists (copy from .env.example if not, then halt for edits)
#   2. Start the local Postgres docker container (db:up) and wait for health
#   3. Push the latest Drizzle schema (db:push)
#   4. Seed the two-account dev couple (test@test.com + test2@test.com)
#   5. Optionally start the dev server (--with-dev or BOOTSTRAP_RUN_DEV=1)
#
# Usage:
#   bun run dev:bootstrap            # bootstrap only
#   bun run dev:bootstrap -- --with-dev  # bootstrap then `bun run dev`
#
# Idempotent. Safe to re-run any time.

set -euo pipefail

cd "$(dirname "$0")/.."

cyan='\033[36m'; green='\033[32m'; yellow='\033[33m'; red='\033[31m'; nc='\033[0m'
log()  { printf "${cyan}[dev-bootstrap]${nc} %s\n" "$*"; }
ok()   { printf "${green}[dev-bootstrap]${nc} ✓ %s\n" "$*"; }
warn() { printf "${yellow}[dev-bootstrap]${nc} %s\n" "$*"; }
die()  { printf "${red}[dev-bootstrap]${nc} ✗ %s\n" "$*" >&2; exit 1; }

WITH_DEV=0
for arg in "$@"; do
	case "$arg" in
		--with-dev) WITH_DEV=1 ;;
		-h|--help)
			grep '^#' "$0" | sed 's/^# \?//'; exit 0 ;;
	esac
done
[[ "${BOOTSTRAP_RUN_DEV:-0}" = "1" ]] && WITH_DEV=1

# 1. .env presence
if [[ ! -f .env ]]; then
	if [[ -f .env.example ]]; then
		cp .env.example .env
		warn ".env was missing — copied from .env.example."
		warn "Fill in PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_SECRET_KEY,"
		warn "then re-run:  bun run dev:bootstrap"
		exit 1
	else
		die ".env and .env.example both missing — cannot continue."
	fi
fi
ok ".env present"

# Source .env so this shell sees vars (lightweight; ignores comments + blank).
set -a
# shellcheck disable=SC1091
source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env | sed -E 's/\r$//')
set +a

for v in PUBLIC_SUPABASE_URL PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY DATABASE_URL; do
	if [[ -z "${!v:-}" ]]; then
		die "$v is unset in .env — fill it in and re-run."
	fi
done
ok "required env vars present"

# 2. Docker postgres
if ! command -v docker >/dev/null 2>&1; then
	die "docker not found in PATH (install docker-desktop or docker-engine)."
fi
log "starting local postgres container…"
docker compose up -d postgres >/dev/null
log "waiting for postgres health…"
for i in $(seq 1 30); do
	if docker compose exec -T postgres pg_isready -U duosync -d duosync >/dev/null 2>&1; then
		ok "postgres healthy"
		break
	fi
	sleep 1
	[[ "$i" = "30" ]] && die "postgres did not become healthy in 30s"
done

# 3. Drizzle schema push
log "pushing Drizzle schema (db:push)…"
bun run db:push
ok "schema synced"

# 4. Seed dev couple
log "seeding dev test couple…"
ALLOW_DEV_SEED=1 bun run scripts/seed-dev-couple.ts
ok "seed complete"

# 5. Optional dev server
if [[ "$WITH_DEV" = "1" ]]; then
	log "starting dev server (Ctrl+C to stop)…"
	exec bun run dev
fi

ok "bootstrap done — start dev server with:  bun run dev"

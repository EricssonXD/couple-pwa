#!/usr/bin/env bash
# scripts/deploy.sh
#
# Production deployment to Cloudflare Workers.
#   1. Sanity-check we're on `main` (override with --force-branch)
#   2. Verify required env (.env or shell): SUPABASE secrets + (optional) DATABASE_URL
#   3. Run `bun run check` and `bun run lint` unless --skip-checks
#   4. Optionally apply Drizzle migrations to production DB (--migrate)
#   5. `bun run build` (SvelteKit + adapter-cloudflare)
#   6. `wrangler deploy`
#
# Usage:
#   bun run deploy                       # full safe deploy
#   bun run deploy -- --skip-checks      # skip check+lint (faster)
#   bun run deploy -- --migrate          # also run drizzle-kit migrate
#   bun run deploy -- --force-branch     # deploy from non-main branch
#   bun run deploy -- --dry-run          # do everything but `wrangler deploy`
#
# Required env (in .env or shell):
#   PUBLIC_SUPABASE_URL
#   PUBLIC_SUPABASE_PUBLISHABLE_KEY
#   SUPABASE_SECRET_KEY     (only required for --migrate or runtime push)
#   DATABASE_URL            (only required for --migrate)
#
# Wrangler picks up account_id from wrangler.jsonc. CLOUDFLARE_API_TOKEN
# (or `wrangler login`) must be set in the shell.

set -euo pipefail

cd "$(dirname "$0")/.."

cyan='\033[36m'; green='\033[32m'; yellow='\033[33m'; red='\033[31m'; nc='\033[0m'
log()  { printf "${cyan}[deploy]${nc} %s\n" "$*"; }
ok()   { printf "${green}[deploy]${nc} ✓ %s\n" "$*"; }
warn() { printf "${yellow}[deploy]${nc} %s\n" "$*"; }
die()  { printf "${red}[deploy]${nc} ✗ %s\n" "$*" >&2; exit 1; }

SKIP_CHECKS=0
RUN_MIGRATE=0
FORCE_BRANCH=0
DRY_RUN=0
for arg in "$@"; do
	case "$arg" in
		--skip-checks) SKIP_CHECKS=1 ;;
		--migrate) RUN_MIGRATE=1 ;;
		--force-branch) FORCE_BRANCH=1 ;;
		--dry-run) DRY_RUN=1 ;;
		-h|--help)
			grep '^#' "$0" | sed 's/^# \?//'; exit 0 ;;
		*) die "unknown arg: $arg (try --help)" ;;
	esac
done

# 1. Branch guard
branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" && "$FORCE_BRANCH" != "1" ]]; then
	die "on branch '$branch' (not 'main'). Pass --force-branch to override."
fi
ok "branch: $branch"

# Warn on dirty tree
if [[ -n "$(git status --porcelain)" ]]; then
	warn "working tree has uncommitted changes"
	git status --short
fi

# 2. Env load + sanity
if [[ -f .env ]]; then
	set -a
	# shellcheck disable=SC1091
	source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env | sed -E 's/\r$//')
	set +a
fi
for v in PUBLIC_SUPABASE_URL PUBLIC_SUPABASE_PUBLISHABLE_KEY; do
	[[ -z "${!v:-}" ]] && die "$v is unset (need it in .env or shell)"
done
ok "supabase env present"

if [[ "$RUN_MIGRATE" = "1" ]]; then
	for v in DATABASE_URL SUPABASE_SECRET_KEY; do
		[[ -z "${!v:-}" ]] && die "$v is unset (required for --migrate)"
	done
fi

# 3. Quality gates
if [[ "$SKIP_CHECKS" != "1" ]]; then
	log "running svelte-check…"
	bun run check
	ok "check clean"
	log "running lint…"
	bun run lint || warn "lint reported issues (non-fatal — pre-existing baseline)"
else
	warn "checks skipped (--skip-checks)"
fi

# 4. DB migrations (opt-in)
if [[ "$RUN_MIGRATE" = "1" ]]; then
	log "applying Drizzle migrations to production DB…"
	bun run db:migrate
	ok "migrations applied"
fi

# 5. Build
log "building SvelteKit (adapter-cloudflare)…"
bun run build
ok "build complete"

# 6. Deploy
if [[ "$DRY_RUN" = "1" ]]; then
	warn "dry run — skipping wrangler deploy"
	exit 0
fi
log "deploying to Cloudflare Workers…"
bunx wrangler deploy
ok "deploy complete"

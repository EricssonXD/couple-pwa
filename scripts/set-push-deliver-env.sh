#!/usr/bin/env bash
# scripts/set-push-deliver-env.sh
#
# Configures the two Cloudflare Worker secrets needed for the inline
# push-deliver kick (see perf(push) commit + supabase/functions/README).
# Without these, enqueue() falls back to cron-only delivery (avg ~30s
# latency, worst ~65s); with them, taps arrive in ~3-5s.
#
# Both values are uploaded as Cloudflare Worker SECRETS (encrypted, not
# stored in wrangler.jsonc). PUSH_DELIVER_URL technically isn't sensitive
# — it's just a public function URL — but treating it as a secret keeps
# the wrangler config file untouched and avoids parse drift.
#
# Usage:
#   bash scripts/set-push-deliver-env.sh \
#     --project-ref <supabase-ref> \
#     --cron-token <same-value-as-pg_cron-uses>
#
# Or interactively (prompts for whichever is missing):
#   bash scripts/set-push-deliver-env.sh
#
# Re-runs are safe — `wrangler secret put` overwrites in place.
#
# Prereqs:
#   - wrangler authenticated (`wrangler login` or CLOUDFLARE_API_TOKEN)
#   - bun (used to invoke wrangler via the project's pinned version)

set -euo pipefail
cd "$(dirname "$0")/.."

cyan='\033[36m'; green='\033[32m'; yellow='\033[33m'; red='\033[31m'; nc='\033[0m'
log()  { printf "${cyan}[push-env]${nc} %s\n" "$*"; }
ok()   { printf "${green}[push-env]${nc} ✓ %s\n" "$*"; }
warn() { printf "${yellow}[push-env]${nc} %s\n" "$*"; }
die()  { printf "${red}[push-env]${nc} ✗ %s\n" "$*" >&2; exit 1; }

PROJECT_REF=""
CRON_TOKEN=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--project-ref) PROJECT_REF="$2"; shift 2 ;;
		--cron-token)  CRON_TOKEN="$2"; shift 2 ;;
		-h|--help) sed -n '2,30p' "$0"; exit 0 ;;
		*) die "Unknown arg: $1 (use --help)" ;;
	esac
done

if [[ -z "$PROJECT_REF" ]]; then
	read -r -p "Supabase project ref (the <ref> in <ref>.functions.supabase.co): " PROJECT_REF
fi
[[ -z "$PROJECT_REF" ]] && die "project ref is required"

if [[ -z "$CRON_TOKEN" ]]; then
	read -r -s -p "CRON_TOKEN (same value pg_cron uses): " CRON_TOKEN
	echo
fi
[[ -z "$CRON_TOKEN" ]] && die "CRON_TOKEN is required"

PUSH_DELIVER_URL="https://${PROJECT_REF}.functions.supabase.co/push-deliver"

log "Uploading PUSH_DELIVER_URL = ${PUSH_DELIVER_URL}"
printf '%s' "$PUSH_DELIVER_URL" | bun x wrangler secret put PUSH_DELIVER_URL
ok "PUSH_DELIVER_URL set"

log "Uploading CRON_TOKEN (length=${#CRON_TOKEN})"
printf '%s' "$CRON_TOKEN" | bun x wrangler secret put CRON_TOKEN
ok "CRON_TOKEN set"

ok "Done. Worker will pick the new vars up on the next deploy:"
ok "       bun run deploy -- --skip-checks"

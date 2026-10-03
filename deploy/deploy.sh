#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

compose=(docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile app)
branch="${DEPLOY_BRANCH:-main}"
force=false
[ "${1:-}" = "--force" ] && force=true

say() { printf '\n== %s\n' "$1"; }

healthy() {
  for _ in $(seq 1 60); do
    api=$(docker inspect -f '{{.State.Health.Status}}' poof-api 2>/dev/null || true)
    if [ "$api" = healthy ] && "${compose[@]}" exec -T web node -e \
      "fetch('http://localhost:3112/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" 2>/dev/null && \
      "${compose[@]}" exec -T supervisor node -e \
      "fetch('http://localhost:3110/health').then((r) => r.json()).then((h) => process.exit(h.ok ? 0 : 1)).catch(() => process.exit(1))" 2>/dev/null; then
      return 0
    fi
    sleep 3
  done
  return 1
}

release() {
  "${compose[@]}" build
  "${compose[@]}" up -d --remove-orphans
}

previous=$(git rev-parse HEAD)
git fetch --quiet origin "$branch"
target=$(git rev-parse "origin/$branch")

if [ "$previous" = "$target" ] && [ "$force" = false ]; then
  echo "Already at $(git log --oneline -1). Use --force to rebuild anyway."
  exit 0
fi

say "Backing up before the deploy"
"${compose[@]}" run --rm backup once

say "Deploying $(git log --oneline -1 "$target")"
git merge --ff-only --quiet "$target"
release

say "Waiting for the supervisor, the API and the web app"
if healthy; then
  docker image prune -f --filter "label=com.docker.compose.project=poof" > /dev/null
  say "Live: $(git log --oneline -1)"
  exit 0
fi

say "Not healthy, rolling back to $(git log --oneline -1 "$previous")"
git reset --hard --quiet "$previous"
release
if healthy; then
  echo "Rolled back. Database migrations from the failed release stay applied;"
  echo "the dump taken above is in backups/db if the schema change has to be undone."
else
  echo "Rollback is not healthy either. Check: ${compose[*]} logs supervisor api web" >&2
fi
exit 1

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

compose=(docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile app)
branch="${DEPLOY_BRANCH:-main}"
force=false
[ "${1:-}" = "--force" ] && force=true

say() { printf '\n== %s\n' "$1"; }

probe='Promise.all([
  fetch("http://poof-web:3112/", { signal: AbortSignal.timeout(5000) }).then((r) => r.ok),
  fetch("http://poof-supervisor:3110/health", { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).then((h) => h.ok),
]).then((up) => process.exit(up.every(Boolean) ? 0 : 1), () => process.exit(1))'

healthy() {
  local deadline=$((SECONDS + 180))
  while [ "$SECONDS" -lt "$deadline" ]; do
    local api
    api=$(docker inspect -f '{{.State.Health.Status}}' poof-api 2>/dev/null || true)
    if [ "$api" = healthy ] && timeout 15 docker exec poof-api node -e "$probe" 2>/dev/null; then
      return 0
    fi
    sleep 3
  done
  return 1
}

release() {
  "${compose[@]}" up -d --build --remove-orphans
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
if release; then
  say "Waiting for the supervisor, the API and the web app"
  if healthy; then
    docker image prune -f --filter "label=com.docker.compose.project=poof" > /dev/null || true
    say "Live: $(git log --oneline -1)"
    exit 0
  fi
  say "Not healthy, the last lines of its logs:"
  "${compose[@]}" logs --tail 30 || true
else
  say "The release did not build or start"
fi

if [ "$previous" = "$target" ]; then
  echo "This was a rebuild of the deployed commit, so there is nothing to roll back to." >&2
  exit 1
fi

say "Rolling back to $(git log --oneline -1 "$previous")"
git reset --hard --quiet "$previous"
if release && healthy; then
  echo "Rolled back. If the failed release got as far as its migrations, they stay applied,"
  echo "and the dump taken above is in backups/db if the schema change has to be undone."
else
  echo "The rollback did not come up either. Check: ${compose[*]} logs --tail 100" >&2
fi
exit 1

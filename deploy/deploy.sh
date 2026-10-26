#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

compose=(docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile app)
branch="${DEPLOY_BRANCH:-main}"
force=false
[ "${1:-}" = "--force" ] && force=true

say() { printf '\n== %s\n' "$1"; }

web_up() {
  docker exec poof-api node -e \
    "fetch('http://poof-web:3112/', { signal: AbortSignal.timeout(5000) }).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" 2>/dev/null
}

supervisor_up() {
  docker exec poof-api node -e \
    "fetch('http://poof-supervisor:3110/health', { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).then((h) => process.exit(h.ok ? 0 : 1)).catch(() => process.exit(1))" 2>/dev/null
}

healthy() {
  for _ in $(seq 1 60); do
    api=$(docker inspect -f '{{.State.Health.Status}}' poof-api 2>/dev/null || true)
    if [ "$api" = healthy ] && web_up && supervisor_up; then
      return 0
    fi
    sleep 3
  done
  return 1
}

release() {
  "${compose[@]}" build && "${compose[@]}" up -d --remove-orphans
}

if [ -z "${POOF_DEPLOY_FROM:-}" ]; then
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
  POOF_DEPLOY_FROM="$previous" exec bash deploy/deploy.sh
fi

previous="$POOF_DEPLOY_FROM"

say "Building, starting and waiting for the supervisor, the API and the web app"
if release && healthy; then
  docker image prune -f --filter "label=com.docker.compose.project=poof" > /dev/null
  say "Live: $(git log --oneline -1)"
  exit 0
fi

say "Not healthy, rolling back to $(git log --oneline -1 "$previous")"
git reset --hard --quiet "$previous"
if release && healthy; then
  echo "Rolled back. Database migrations from the failed release stay applied."
  echo "The dump taken above is in backups/db if the schema change has to be undone."
else
  echo "Rollback is not healthy either. Check: ${compose[*]} logs" >&2
fi
exit 1

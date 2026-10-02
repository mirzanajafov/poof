#!/usr/bin/env bash
set -euo pipefail

label="${1:?usage: bench/run-linux.sh <label>}"
steps="${STEPS:-dataset b1 b2 b3 b4}"
cpu_limits="${CPU_LIMITS:-1.5 2 4}"
presets="${PRESETS:-webp-1600,thumb-320}"
memory="${MEMORY:-6g}"
root="$(cd "$(dirname "$0")/.." && pwd)"
host_root="$(cd "$root" && (pwd -W 2>/dev/null || pwd))"
export MSYS_NO_PATHCONV=1

docker build -q -t poof-bench -f "$host_root/bench/Dockerfile" "$host_root" >/dev/null
docker network inspect poof-bench >/dev/null 2>&1 || docker network create poof-bench >/dev/null

cleanup() {
  docker rm -f poof-bench-redis >/dev/null 2>&1 || true
  docker network rm poof-bench >/dev/null 2>&1 || true
}
trap cleanup EXIT

run() {
  local cpus="$1"
  shift
  docker run --rm --cpus "$cpus" --memory "$memory" --pids-limit 256 -e CPU_LIMIT="$cpus" \
    -e REDIS_URL=redis://poof-bench-redis:6379 --network poof-bench \
    -v "$host_root/data:/app/data" -v "$host_root/bench/results:/app/bench/results" \
    poof-bench node "$@"
}

for step in $steps; do
  case "$step" in
    dataset)
      [ -f "$root/data/synthetic/manifest.json" ] || run 2 bench/dist/make-synthetic.js --out data/synthetic --count 100 --seed 1
      [ -f "$root/data/nasa/manifest.json" ] || run 2 bench/dist/fetch-nasa.js --out data/nasa --count 40
      ;;
    b1)
      run 2 bench/dist/b1-item-cost.js --data data/synthetic --data data/nasa --presets "$presets" --label "$label"
      ;;
    b2)
      for cpus in $cpu_limits; do
        run "$cpus" bench/dist/b2-concurrency.js --cpus "$cpus" --label "$label"
      done
      ;;
    b3)
      run 2 bench/dist/b3-spawn.js --label "$label"
      ;;
    b4)
      docker run -d --rm --name poof-bench-redis --network poof-bench --cpus 1 --memory 256m redis:8-alpine >/dev/null
      sleep 2
      run 2 bench/dist/b4-coordination.js --label "$label"
      docker rm -f poof-bench-redis >/dev/null
      ;;
  esac
done

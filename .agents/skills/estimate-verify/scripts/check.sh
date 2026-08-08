#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

if [ ! -d node_modules ]; then
  echo "node_modules is missing. Install dependencies with the repository's normal npm setup before running this check."
  exit 2
fi

echo "== npm run lint =="
npm run lint

echo
echo "== npm run build =="
npm run build

echo
echo "Verification commands passed."

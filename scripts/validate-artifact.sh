#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

worker="${SITES_PROJECT_ROOT}/dist/server/index.js"
hosting="${SITES_PROJECT_ROOT}/dist/.openai/hosting.json"

[[ -f "${worker}" ]] || {
  echo "Missing Sites Worker entry: dist/server/index.js" >&2
  exit 66
}
[[ -f "${hosting}" ]] || {
  echo "Missing packaged Sites manifest: dist/.openai/hosting.json" >&2
  exit 66
}

diff -r "${SITES_PROJECT_ROOT}/drizzle" "${SITES_PROJECT_ROOT}/dist/.openai/drizzle"
cmp "${SITES_PROJECT_ROOT}/.openai/hosting.json" "${hosting}"
node --input-type=module <<'NODE'
import { loadWorkerInNode } from "./scripts/load-worker-in-node.mjs";
const worker = await loadWorkerInNode();
if (typeof worker?.fetch !== "function") throw new Error("Missing Worker default.fetch");
NODE

echo "Validated Worker entry, hosting manifest and packaged migration history."

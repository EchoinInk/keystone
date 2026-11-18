#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

# flock(2) works on both Linux and macOS and releases the lock on process exit.
exec python3 - <<'PY'
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

node, platform = subprocess.check_output(
    ["node", "-p", "[process.version, process.platform+'-'+process.arch].join(' ')"],
    text=True,
).split()
npm_version = subprocess.check_output(["npm", "--version"], text=True).strip()
expected_node = "v" + Path(".nvmrc").read_text().strip()
expected_npm = json.loads(Path("package.json").read_text())["packageManager"]
if node != expected_node or "npm@" + npm_version != expected_npm:
    sys.exit(f"Locked install requires Node {expected_node} and {expected_npm}; found {node} and npm@{npm_version}.")

cache = Path(os.environ["npm_config_cache"])
lock = (cache.parent / "install.lock").open("a")
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit("Another dependency installation is running in this checkout.")

digest = hashlib.sha256(Path("package-lock.json").read_bytes()).hexdigest()
seed = os.environ.get("SITES_NPM_CACHE_SEED")
if seed:
    marker = Path(seed) / ".sites-lockfile-sha256"
    if marker.is_file() and marker.read_text().strip() == digest:
        shutil.copytree(seed, cache, dirs_exist_ok=True)

# npm ci checks the manifest, lock and package integrity, including cache hits.
subprocess.run([sys.executable, "scripts/run-bounded.py", "install", "npm", "ci", "--prefer-offline"], check=True)
if not os.access("node_modules/.bin/vinext", os.X_OK):
    sys.exit("The locked installation did not provide vinext.")
Path("node_modules/.sites-install.json").write_text(json.dumps({
    "lockfile_sha256": digest, "node": node, "npm": npm_version, "platform": platform
}) + "\n")
PY

"""Run an installation or build with the Sites timeout on Linux and macOS."""
import os
import re
import signal
import subprocess
import sys


def seconds(value):
    match = re.fullmatch(r"(\d+(?:\.\d+)?)([smhd]?)", value)
    if not match:
        raise ValueError(f"Unsupported duration {value!r}")
    return float(match[1]) * {"": 1, "s": 1, "m": 60, "h": 3600, "d": 86400}[match[2]]


operation, *command = sys.argv[1:]
timeout, grace = {"install": ("8m", "15s"), "build": ("3m", "10s")}[operation]
prefix = f"SITES_{operation.upper()}_"
timeout = seconds(os.environ.get(prefix + "TIMEOUT", timeout))
grace = seconds(os.environ.get(prefix + "KILL_AFTER", grace))
child = subprocess.Popen(command, start_new_session=True)
try:
    sys.exit(child.wait(timeout=timeout or None))
except (subprocess.TimeoutExpired, KeyboardInterrupt):
    os.killpg(child.pid, signal.SIGTERM)
    try:
        child.wait(timeout=grace or None)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
    print(f"{operation} interrupted or exceeded its {timeout:g}s timeout", file=sys.stderr)
    sys.exit(124)

"""Compare every packaged filename and byte from two independent builds."""
import hashlib
import os
from pathlib import Path
import secrets
import subprocess
from tempfile import TemporaryDirectory

env = os.environ.copy()
env.setdefault("KEYSTONE_BUILD_KEY", secrets.token_hex(32))
if "KEYSTONE_BUILD_REVISION" not in env:
    env["KEYSTONE_BUILD_REVISION"] = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], text=True
    ).strip()


def build():
    subprocess.run(["npm", "run", "build"], env=env, check=True)
    return {p: hashlib.sha256(p.read_bytes()).digest()
            for p in sorted(Path("dist").rglob("*")) if p.is_file()}


first = build()
# Start the second build with no packaged files from the first one. Keep
# the first artifact available if the rebuild fails before producing output.
with TemporaryDirectory(dir=Path("dist").resolve().parent / ".sites-runtime") as temp:
    previous = Path(temp) / "dist"
    Path("dist").rename(previous)
    try:
        second = build()
    except BaseException:
        if Path("dist").exists():
            Path("dist").rename(Path(temp) / "incomplete")
        previous.rename("dist")
        raise
differences = sorted(p for p in first.keys() | second.keys() if first.get(p) != second.get(p))
if differences:
    raise SystemExit("Build differences:\n" + "\n".join(map(str, differences)))
print(f"Identical production artifacts ({len(first)} files).")

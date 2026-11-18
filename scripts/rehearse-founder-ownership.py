"""Rehearse Phase 1 on an in-memory copy of a consistent, offline SQLite backup."""

import argparse
from hashlib import sha256
import json
from pathlib import Path
import sqlite3


def quoted(identifier):
    return '"' + identifier.replace('"', '""') + '"'


def inventory(db, tables):
    result = {}
    for table in tables:
        # Baseline tables use a single primary key. Include every stored value,
        # so the digest covers original IDs, links, snapshots and timestamps.
        columns = db.execute(f"PRAGMA table_info({quoted(table)})").fetchall()
        keys = [c[1] for c in sorted(columns, key=lambda c: c[5]) if c[5]]
        order = ", ".join(map(quoted, keys)) or "rowid"
        digest = sha256()
        count = 0
        for row in db.execute(f"SELECT * FROM {quoted(table)} ORDER BY {order}"):
            digest.update(json.dumps(row, separators=(",", ":")).encode() + b"\n")
            count += 1
        result[table] = {"count": count, "sha256": digest.hexdigest()}
    return result


def rehearse(snapshot):
    path = snapshot.resolve(strict=True)
    if any(Path(str(path) + suffix).exists() for suffix in ("-wal", "-journal")):
        raise ValueError("Supply a consistent standalone SQLite backup with journals checkpointed.")
    source = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
    copy = sqlite3.connect(":memory:")
    try:
        source.backup(copy)
        tables = [r[0] for r in copy.execute(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' "
            "AND name NOT GLOB '_cf_*' ORDER BY name"
        )]
        if not {"documents", "tasks", "revisions", "system_meta"}.issubset(tables):
            raise ValueError("Expected a founder database backup from the Phase 1 baseline.")
        if {"workspace_owner", "workspace_files"}.intersection(tables):
            raise ValueError("Supply a backup taken before migration 0007.")
        if copy.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("SQLite integrity check failed.")
        before = inventory(copy, tables)
        migration = Path(__file__).resolve().parents[1] / "drizzle/0007_founder_workspace.sql"
        copy.executescript(migration.read_text())
        copy.execute("INSERT INTO workspace_owner(slot, site_origin, subject) VALUES(1, ?, ?)",
                     ("https://example.invalid", "offline-rehearsal"))
        after = inventory(copy, tables)
        if before != after:
            raise ValueError("Existing rows changed during the in-memory rehearsal.")
        issues = copy.execute("PRAGMA foreign_key_check").fetchall()
        unapproved = copy.execute(
            "SELECT count(*) FROM documents d LEFT JOIN workspace_files f ON f.object_key=d.object_key "
            "WHERE f.object_key IS NULL"
        ).fetchone()[0]
        print(json.dumps({"original_tables": before, "identical_after_rehearsal": True,
                          "foreign_key_violations": len(issues),
                          "documents_requiring_object_review": unapproved}, indent=2))
        return 1 if issues else 0
    finally:
        copy.close()
        source.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    raise SystemExit(rehearse(parser.parse_args().snapshot))

"""Strict comparison of immutable application records by database identity."""

KEYS = {"requests": "id", "staff": "id", "history": "id",
        "flyway": "installed_rank", "accounts": "id"}


def compare_snapshots(before, after):
    if set(before) != set(after):
        raise ValueError("Snapshot table set changed")
    for table in before:
        key = KEYS[table]

        def index(rows):
            indexed = {row[key]: row for row in rows or []}
            if len(indexed) != len(rows or []):
                raise ValueError(f"Duplicate identity in {table}")
            return indexed

        old, new = index(before[table]), index(after[table])
        if old.keys() != new.keys():
            missing = sorted(str(value) for value in old.keys() - new.keys())
            added = sorted(str(value) for value in new.keys() - old.keys())
            raise ValueError(f"{table}: missing IDs {missing}; added IDs {added}")
        for identity, row in old.items():
            if row != new[identity]:
                fields = sorted(name for name in row.keys() | new[identity].keys()
                                if name not in row or name not in new[identity]
                                or row[name] != new[identity][name])
                raise ValueError(f"{table} {identity}: changed fields {fields}")

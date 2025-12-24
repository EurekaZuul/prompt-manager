from __future__ import annotations

from dataclasses import dataclass


@dataclass
class VersionService:
    """Utility for semantic version operations."""

    default_version: str = "1.0.0"

    def generate_next_version(self, current_version: str | None, change_type: str = "patch") -> str:
        if not current_version:
            return self.default_version

        try:
            major, minor, patch = [int(part) for part in current_version.split(".", 3)]
        except ValueError:
            return self.default_version

        change_type = (change_type or "patch").lower()
        if change_type == "major":
            major += 1
            minor = 0
            patch = 0
        elif change_type == "minor":
            minor += 1
            patch = 0
        else:
            patch += 1

        return f"{major}.{minor}.{patch}"

    def compare_versions(self, version_a: str, version_b: str) -> int:
        try:
            parts_a = [int(part) for part in version_a.split(".", 3)]
            parts_b = [int(part) for part in version_b.split(".", 3)]
        except ValueError:
            return 0

        for a, b in zip(parts_a, parts_b):
            if a > b:
                return 1
            if a < b:
                return -1
        return 0

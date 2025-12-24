from __future__ import annotations

from diff_match_patch import diff_match_patch

from app.schemas.models import DiffResult


class DiffService:
    def __init__(self) -> None:
        self._dmp = diff_match_patch()

    def compare_texts(self, source: str, target: str) -> DiffResult:
        diffs = self._dmp.diff_main(source or "", target or "")
        self._dmp.diff_cleanupSemantic(diffs)

        additions = 0
        deletions = 0
        diff_html_parts: list[str] = []

        for operation, text in diffs:
            if operation == self._dmp.DIFF_INSERT:
                additions += len(text)
                diff_html_parts.append(f'<span class="diff-added">{text}</span>')
            elif operation == self._dmp.DIFF_DELETE:
                deletions += len(text)
                diff_html_parts.append(f'<span class="diff-deleted">{text}</span>')
            else:
                diff_html_parts.append(text)

        total = max(len(source) + len(target), 1)
        change_rate = (additions + deletions) / total * 100

        return DiffResult(
            additions=additions,
            deletions=deletions,
            change_rate=change_rate,
            diff_html="".join(diff_html_parts),
        )

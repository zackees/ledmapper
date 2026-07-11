#!/usr/bin/env python3
"""PreToolUse hook: block direct `playwright test` invocations.

Modeled on the pattern used by https://github.com/zackees/clud's
`.claude/hooks/check-soldr.py` (deny via PreToolUse JSON output rather than
a non-zero exit code).

ledmapper has a blessed test runner (`npm run test:integration`, backed by
`scripts/run-playwright.mjs`) that a bare `playwright test` / `npx
playwright test` invocation bypasses entirely. The blessed runner exists
because a raw invocation:

  - defaults to an unbounded worker count, which was observed to silently
    kill the whole run locally (dev server and every Chrome process just
    gone, no error) -- see the ui-dev-loop skill;
  - doesn't manage the dev server (reuse vs. start-and-tear-down);
  - doesn't tee output to a log file the agent can inspect afterward
    without re-scrolling a huge terminal buffer.

Only the `test` subcommand is blocked -- `playwright install`,
`playwright show-report`, `playwright --version`, etc. pass through
untouched, since the blessed runner doesn't wrap those.
"""

from __future__ import annotations

import json
import os
import queue
import re
import shlex
import sys
import threading
import time

BLESSED_COMMAND = "npm run test:integration"
STDIN_READ_CHUNK_BYTES = 64 * 1024
STDIN_READ_MAX_BYTES = 1024 * 1024
STDIN_READ_IDLE_TIMEOUT_SEC = 0.25
STDIN_READ_DEADLINE_SEC = 2.0
ENV_ASSIGNMENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
SHELL_OPERATORS = ("&&", "||", ";", "|", "&")


def strip_leading_env_assignments(tokens: list[str]) -> list[str]:
    """Drop leading `FOO=bar BAR=baz` env-var tokens so the head is the real command."""
    i = 0
    while i < len(tokens) and ENV_ASSIGNMENT_RE.match(tokens[i]):
        i += 1
    return tokens[i:]


def split_segments(cmd: str) -> list[list[str]]:
    """Tokenize `cmd` and split into segments on shell chaining/pipe
    operators (`&&`, `||`, `;`, `|`, and a lone `&` -- which also absorbs a
    leading PowerShell call operator, `& "foo" playwright test`).

    Quote-aware: an operator character *inside* a quoted string (e.g. a
    grep pattern like `"npx playwright\\|playwright test"`, or a commit
    message containing `;`) is part of that string's token, not a real
    separator -- a naive regex split on the raw text would wrongly treat
    it as one and could deny an unrelated command that merely mentions
    "playwright test" in a quoted argument.
    """
    lexer = shlex.shlex(cmd, posix=True, punctuation_chars="|;&")
    lexer.whitespace_split = True
    try:
        tokens = list(lexer)
    except ValueError:
        # Unbalanced quotes etc. -- fail open, nothing we can safely parse.
        return []

    segments: list[list[str]] = [[]]
    for tok in tokens:
        if tok in SHELL_OPERATORS:
            segments.append([])
        else:
            segments[-1].append(tok)
    return [seg for seg in segments if seg]


def normalize(token: str) -> str:
    base = token.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    base = re.sub(r"\.(cmd|exe|ps1|bat)$", "", base, flags=re.IGNORECASE)
    return base


def _segment_is_blocked(tokens: list[str]) -> bool:
    tokens = strip_leading_env_assignments(tokens)
    if not tokens:
        return False

    head = normalize(tokens[0])
    rest = tokens[1:]

    if head == "npx":
        # Skip npx's own flags (--yes, -y, --no-install, etc.) to find the
        # package name it's actually running.
        i = 0
        while i < len(rest) and rest[i].startswith("-"):
            i += 1
        if i >= len(rest) or normalize(rest[i]) != "playwright":
            return False
        rest = rest[i + 1:]
    elif head == "playwright":
        pass
    else:
        return False

    subcommand = rest[0] if rest else None
    return subcommand == "test"


def is_blocked_playwright_test(command: str) -> bool:
    """True iff any segment of `command` directly invokes `playwright test`
    (any launcher) -- checks every `&&`/`;`/`|`-chained segment, not just
    the first, so `cd x && npx playwright test` is still caught. Quote-aware
    (see `split_segments`), so a quoted string that merely *mentions*
    "playwright test" alongside an operator character is not mistaken for
    a real chained command."""
    return any(_segment_is_blocked(seg) for seg in split_segments(command))


def deny(reason: str) -> None:
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        },
        sys.stdout,
    )


def read_stdin_bounded() -> str:
    out: "queue.Queue[bytes | BaseException | None]" = queue.Queue()

    def worker() -> None:
        try:
            fd = sys.stdin.fileno()
            while True:
                chunk = os.read(fd, STDIN_READ_CHUNK_BYTES)
                if not chunk:
                    out.put(None)
                    return
                out.put(chunk)
        except BaseException as exc:  # pragma: no cover - defensive fallback path
            out.put(exc)

    thread = threading.Thread(target=worker, name="ledmapper-playwright-hook-stdin", daemon=True)
    thread.start()

    chunks: list[bytes] = []
    byte_count = 0
    deadline = time.monotonic() + STDIN_READ_DEADLINE_SEC
    idle_until: float | None = None
    while True:
        now = time.monotonic()
        wait_until = deadline if idle_until is None else min(deadline, idle_until)
        if now >= wait_until:
            break
        try:
            item = out.get(timeout=max(0.001, wait_until - now))
        except queue.Empty:
            break
        if item is None:
            break
        if isinstance(item, BaseException):
            break
        chunks.append(item)
        byte_count += len(item)
        idle_until = time.monotonic() + STDIN_READ_IDLE_TIMEOUT_SEC
        if byte_count >= STDIN_READ_MAX_BYTES:
            break

    return b"".join(chunks).decode("utf-8", errors="replace").lstrip("\ufeff")


def main() -> int:
    try:
        raw = read_stdin_bounded()
        if not raw.strip():
            return 0
        payload = json.loads(raw)
    except Exception:
        return 0

    tool_input = payload.get("tool_input") or {}
    command = tool_input.get("command")
    if not isinstance(command, str):
        return 0

    if not is_blocked_playwright_test(command):
        return 0

    deny(
        "Direct `playwright test` invocations are blocked in this repo. "
        f"Use the blessed runner instead: `{BLESSED_COMMAND}` "
        "(runs everything) or "
        f"`{BLESSED_COMMAND} -- <spec-or-pattern>` (scoped). "
        "It reuses the running dev server, caps worker count to avoid the "
        "OOM-style crash an unbounded local run can hit, and tees output "
        "to .temp/logs/playwright-*.log. See CLAUDE.md's "
        '"Running Playwright tests" section.'
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

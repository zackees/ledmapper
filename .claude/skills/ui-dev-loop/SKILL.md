---
name: ui-dev-loop
description: Persistent agent dev-loop for UI work — keep the dev server and browser session alive across edits, wait on an explicit HMR-ready signal instead of sleeping, and query only what changed. Use when making UI/behavior changes to any tool (demo, moviemaker, movieplayer, shapeeditor, screenmap) and you need to observe the running app, not just pass unit tests.
---

# Persistent UI dev loop

The old loop restarts the server and browser on every check: edit → start
server → launch browser → navigate → rebuild state → run Playwright → parse
a huge result → diagnose → repeat. This burns tokens on repeated startup
output and stale/duplicate logs, and loses app state (route, in-tool view)
on every check.

The loop this skill teaches: edit → Vite HMR (or reload) applies it → wait
on an explicit ready signal → query only what changed → next edit. One
server, one browser session, for the whole task.

## Persistence rules

- Before running `npm run dev`, check whether something is already
  serving port 8080 (`curl -sk -o /dev/null -w '%{http_code}' https://localhost:8080/`
  — the server is HTTPS if `.certs/` exists, HTTP otherwise). Start it once
  via your harness's background-task support; never restart it between
  edits.
- Use **one named agent-browser session per task**: `--session <task-name>`
  on every command. Reuse it — do not `close` and reopen between edits.
- Navigate only if the target route isn't already open:
  `agent-browser --session <name> get url`.

## The edit cycle

1. **Baseline**, before editing:
   ```
   agent-browser --session <name> console --clear
   agent-browser --session <name> errors --clear
   agent-browser --session <name> eval "window.__agentUi?.update"
   ```
   Record the returned update number.

2. **Edit the code.**

3. **Wait — never `sleep`:**
   ```
   agent-browser --session <name> wait --fn "window.__agentUi?.phase === 'ready'"
   ```
   Do not additionally require `update > baseline` — see the full-reload
   caveat below, where the counter resets rather than increments.

4. **On `phase === 'error'`**, read the compile error before touching
   anything else: `agent-browser --session <name> eval "window.__agentUi?.error"`.

5. **Query narrowly:**
   ```
   agent-browser --session <name> errors
   agent-browser --session <name> snapshot -s "#the-changed-panel" -i -c --depth 4
   agent-browser --session <name> network requests --type xhr,fetch
   ```
   Prefer accessibility snapshots for structural questions (is the button
   present/disabled/what's its label). Use `agent-browser --session <name>
   screenshot <path>` only for visual questions (spacing, color, overlap) —
   scope to a selector when possible, not `--full`.

## ledmapper-specific: canvas/WebGL state (read this first)

Every tool renders to a `<canvas>` (Three.js and/or Canvas 2D). A DOM
snapshot of a canvas is empty — it tells you nothing about LED count,
recording state, or playback. **The primary state channel for this repo is
`window.__lmDebug`, not DOM snapshots:**

```
agent-browser --session <name> eval "window.__lmDebug?.moviemaker?.getState()"
agent-browser --session <name> eval "window.__lmDebug?.movieplayer?.getState()"
agent-browser --session <name> eval "window.__lmDebug?.shapeeditor?.getState()"
```

Only `moviemaker`, `movieplayer`, and `shapeeditor` are registered (see
`src/debug-registry.ts`) — `demo` and `screenmap` are not, as of this
writing. Also pull the event trail for a fuller picture:

```
agent-browser --session <name> eval "window.__lmLog?.dump()"
```

See `.claude/skills/debugging/SKILL.md` for what the event trail and
watchdog warnings mean. There is no React introspection here (vanilla TS
throughout) — `__lmDebug` fills that role instead.

## The HMR sentinel and its real behavior here (important)

`src/agent-ui-sentinel.ts` exposes `window.__agentUi = {phase, update,
lastUpdateAt, error}`, driven by Vite's HMR event stream. Dev-only, absent
from production builds.

**Verified live behavior, not assumed:**
- **CSS edits hot-patch in place.** `phase` goes `ready → updating →
  ready`, `update` increments, **zero page reloads**, app state (route,
  in-tool view, loaded video/screenmap) is preserved.
- **JS/TS edits currently trigger Vite's full-reload fallback**, because no
  module in this codebase calls `import.meta.hot.accept()`. The page fully
  reloads; `window.__agentUi` re-initializes fresh (`phase: 'ready',
  update: 0`) rather than incrementing. **App state is NOT preserved
  across a JS/TS edit today** — the router will re-run from whatever route
  is in the URL, but in-tool state (loaded file, playback position, drag
  selection, etc.) is lost.
- This is why step 3 above waits on `phase === 'ready'` alone rather than
  an incrementing counter: the counter comparison is only meaningful for
  CSS-only changes.

Practical effect: this stack still removes the sleep-and-guess pattern and
the repeated server/browser relaunch overhead for **every** edit, but the
state-preservation benefit this stack was designed for currently applies
fully only to CSS changes. If a task does many iterations on one loaded-state
scenario (e.g. a specific loaded video + screenmap in moviemaker), expect
to re-establish that state after each JS/TS edit — plan the edit-observe
loop accordingly, and prefer batching several related JS/TS changes before
re-checking rather than round-tripping per line.

## Testing split

- Narrowest relevant unit test during iteration: `npm test -- <pattern>`
  where practical, or the full `npm test` (it's fast, ~2s for 591 tests).
- Playwright / GPU specs only at task completion or for broad-impact
  changes — see the main debugging skill for the `@gpu` rules.
  HMR-applied (or reload-applied) ≠ correct: an explicit ready signal only
  means the new code is live, not that it's right.
- **Always run Playwright via `npm run test:integration [-- <spec>]`**
  (`scripts/run-playwright.mjs`) — **never** `playwright test` or `npx
  playwright test` directly. A `PreToolUse` hook
  (`.claude/hooks/check-playwright.py`) blocks direct invocations and
  errors with this same instruction. The blessed runner already does what
  used to be manual advice here: reuses an already-running dev server
  (starts one only if needed, tears down only the one it started), never
  sets `CI=1` (which would force a from-scratch production rebuild +
  single-worker run every invocation), caps `--workers` to a safe default
  (an unconstrained local run was observed to silently die mid-run — no
  crash message, dev server and every Chrome process just gone), and tees
  full output to a gitignored `.temp/logs/playwright-*.log` while printing
  a compact tail instead of the full firehose.
- **Do not run the full suite as your default check during iteration** —
  it takes minutes even with the blessed runner. Pick the spec(s) that
  actually cover the changed surface: `npm run test:integration --
  console-errors.spec.ts` for "does any tool page still load cleanly", or
  the relevant tool's own spec for behavior changes. Save the full suite
  for final confirmation.
- Before declaring a UI task done, validate from a clean state at least
  once: a fresh `agent-browser --session <name> reload` (or a brand-new
  session) plus the relevant formal test. Persistent sessions optimize
  iteration, not final verification — a page that works after ten edits
  may still fail from a cold load.

## Cleanup

Browser session state can contain cookies/auth — never commit it (see
`.gitignore`: `.agent-ui/`, `.agent-browser/`, `.auth/`,
`*.browser-state.json`). Close the session when the task is done:
`agent-browser --session <name> close`.

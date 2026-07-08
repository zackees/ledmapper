/**
 * Lightweight structured event log for debugging user flows.
 *
 * Every significant pipeline event (screenmap load, video source change,
 * recording start/stop/save, movie load) funnels through a scoped logger
 * (see `createLogger`) so a session can be reconstructed from the console or
 * from Playwright via `window.__lmLog`.
 *
 * Not a general logger: events only, small fixed-size ring buffer, always on
 * for `info`/`warn`/`error` (the console cost of a few dozen events per
 * session is negligible and the payoff is that bug reports contain the
 * event trail by default). `debug` is gated — see "Level gating" below.
 *
 * Schema mirrors Sentry breadcrumbs 1:1 (`category` -> `scope`, `message` ->
 * `event`, `level`, `timestamp` -> `t`, `data`) so error tracking could be
 * bolted on later without a schema migration.
 *
 * ## Level gating
 *
 * The active level defaults to `debug` in dev builds (`import.meta.env.DEV`)
 * and `info` otherwise. It can be overridden at runtime via
 * `localStorage['lm:log']` or a `?lmlog=<level>` query param (the query
 * param value is persisted to localStorage so a repro link keeps working
 * across reloads). `debug`/`info` entries below the active level are
 * dropped; `warn`/`error` are always recorded so real problems are never
 * silently lost even if the active level was narrowed.
 */

export type LmLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LmLogEntry {
    /** ms since page load (performance.now()), rounded. */
    t: number;
    /** Tool or module that emitted the event, e.g. 'moviemaker'. */
    scope: string;
    /** Short machine-readable event name, e.g. 'screenmap-load'. */
    event: string;
    /** Severity — see "Level gating" above. */
    level: LmLogLevel;
    /** Optional structured payload; must be JSON-serializable. */
    data?: unknown;
}

const MAX_ENTRIES = 500;
const entries: LmLogEntry[] = [];

const STORAGE_KEY = 'lm:log';
const QUERY_PARAM = 'lmlog';

const LEVEL_ORDER: Record<LmLogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function isLmLogLevel(value: string | null | undefined): value is LmLogLevel {
    return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

/** Pure helper (no DOM access) so query-param parsing is unit-testable. */
export function parseLevelFromQueryString(search: string): LmLogLevel | null {
    const params = new URLSearchParams(search);
    const raw = params.get(QUERY_PARAM);
    return isLmLogLevel(raw) ? raw : null;
}

function readStoredLevel(): LmLogLevel | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return isLmLogLevel(raw) ? raw : null;
    } catch {
        return null;
    }
}

function writeStoredLevel(level: LmLogLevel): void {
    try { localStorage.setItem(STORAGE_KEY, level); } catch { /* ignore — storage unavailable */ }
}

/** `import.meta.env.DEV` is Vite-only; plain Node (unit tests) has no `env`. */
function isDevBuild(): boolean {
    return (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
}

function defaultLevel(): LmLogLevel {
    return isDevBuild() ? 'debug' : 'info';
}

/**
 * Resolve the currently-active gating level. Re-read on every call (log
 * volume is low, a few dozen events per session) so tests and runtime
 * DevTools edits to localStorage take effect immediately without a reload.
 */
function getActiveLevel(): LmLogLevel {
    return readStoredLevel() ?? defaultLevel();
}

/** One-time (per page load) side effect: a `?lmlog=` query param wins over
 *  whatever is already in localStorage, and persists so repro links survive
 *  a reload without the query string. */
function syncQueryParamLevel(): void {
    if (typeof location === 'undefined') return;
    const fromQuery = parseLevelFromQueryString(location.search);
    if (fromQuery) writeStoredLevel(fromQuery);
}

function nowMs(): number {
    try { return Math.round(performance.now()); } catch { return 0; }
}

/** debug/info mirror to console.log; no-console is disabled here on purpose:
 *  debug events must not masquerade as warnings or errors. warn/error mirror
 *  to their real console counterparts (allowed by the no-console rule) so
 *  DevTools behavior is unchanged for callers migrating off raw console.*. */
function mirrorToConsole(level: LmLogLevel, scope: string, event: string, data?: unknown): void {
    const tag = `[lm:${scope}] ${event}`;
    if (level === 'warn') {
        if (data !== undefined) console.warn(tag, data); else console.warn(tag);
        return;
    }
    if (level === 'error') {
        if (data !== undefined) console.error(tag, data); else console.error(tag);
        return;
    }
    // eslint-disable-next-line no-console
    if (data !== undefined) console.log(tag, data);
    // eslint-disable-next-line no-console
    else console.log(tag);
}

function shouldRecord(level: LmLogLevel): boolean {
    if (level === 'warn' || level === 'error') return true;
    return LEVEL_ORDER[level] >= LEVEL_ORDER[getActiveLevel()];
}

function record(level: LmLogLevel, scope: string, event: string, data?: unknown): void {
    if (!shouldRecord(level)) return;
    const entry: LmLogEntry = { t: nowMs(), scope, event, level };
    if (data !== undefined) entry.data = data;
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    mirrorToConsole(level, scope, event, data);
}

/** Record a pipeline event at `info` level; also mirrors to the console as
 *  `[lm:scope] event`. Kept for existing call sites — prefer `createLogger`
 *  for new code so the scope isn't repeated at every call site. */
export function logEvent(scope: string, event: string, data?: unknown): void {
    record('info', scope, event, data);
}

export interface Logger {
    debug(event: string, data?: unknown): void;
    info(event: string, data?: unknown): void;
    warn(event: string, data?: unknown): void;
    error(event: string, data?: unknown): void;
}

/** Bind a fixed `scope` so call sites read `log.warn('event', data)` instead
 *  of repeating the scope string at every call. */
export function createLogger(scope: string): Logger {
    return {
        debug: (event, data) => { record('debug', scope, event, data); },
        info: (event, data) => { record('info', scope, event, data); },
        warn: (event, data) => { record('warn', scope, event, data); },
        error: (event, data) => { record('error', scope, event, data); },
    };
}

/** Snapshot of the recorded events (oldest first). */
export function getEventLog(): readonly LmLogEntry[] {
    return entries;
}

/** Test-only: clear the ring buffer between test cases. */
export function _resetLogForTests(): void {
    entries.length = 0;
}

function firstStackLine(err: unknown): string | undefined {
    if (!(err instanceof Error) || typeof err.stack !== 'string') return undefined;
    const lines = err.stack.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    // lines[0] is usually "Name: message"; the call site is the next frame.
    return lines[1] ?? lines[0];
}

// DevTools / Playwright hook: window.__lmLog.entries, window.__lmLog.dump().
declare global {
    interface Window {
        __lmLog?: { entries: readonly LmLogEntry[]; dump: () => string };
    }
}

if (typeof window !== 'undefined') {
    syncQueryParamLevel();

    window.__lmLog = {
        entries,
        dump: () => entries.map((e) => `${String(e.t).padStart(8)}ms [${e.level}] [${e.scope}] ${e.event}${e.data !== undefined ? ' ' + JSON.stringify(e.data) : ''}`).join('\n'),
    };

    // Global capture (minimal Sentry auto-instrument set): uncaught errors
    // and unhandled promise rejections always land in the ring buffer, even
    // from code paths that never call the logger directly.
    window.addEventListener('error', (event: ErrorEvent) => {
        record('error', 'window', 'onerror', { message: event.message, stack: firstStackLine(event.error) });
    });

    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        const reason: unknown = event.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        record('error', 'window', 'unhandledrejection', { message, stack: firstStackLine(reason) });
    });
}

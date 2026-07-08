/**
 * Lightweight structured event log for debugging user flows.
 *
 * Every significant pipeline event (screenmap load, video source change,
 * recording start/stop/save, movie load) funnels through logEvent() so a
 * session can be reconstructed from the console or from Playwright via
 * `window.__lmLog`.
 *
 * Not a general logger: events only, small fixed-size ring buffer, always on
 * (the console cost of a few dozen events per session is negligible and the
 * payoff is that bug reports contain the event trail by default).
 */

export interface LmLogEntry {
    /** ms since page load (performance.now()), rounded. */
    t: number;
    /** Tool or module that emitted the event, e.g. 'moviemaker'. */
    scope: string;
    /** Short machine-readable event name, e.g. 'screenmap-load'. */
    event: string;
    /** Optional structured payload; must be JSON-serializable. */
    data?: unknown;
}

const MAX_ENTRIES = 500;
const entries: LmLogEntry[] = [];

/** Record a pipeline event; also mirrors to the console as `[lm:scope] event`. */
export function logEvent(scope: string, event: string, data?: unknown): void {
    const entry: LmLogEntry = { t: Math.round(performance.now()), scope, event };
    if (data !== undefined) entry.data = data;
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    // Mirror to the console so the event trail shows up in DevTools and bug
    // reports without any setup. no-console is disabled here on purpose:
    // debug events must not masquerade as warnings or errors.
    // eslint-disable-next-line no-console
    if (data !== undefined) console.log(`[lm:${scope}] ${event}`, data);
    // eslint-disable-next-line no-console
    else console.log(`[lm:${scope}] ${event}`);
}

/** Snapshot of the recorded events (oldest first). */
export function getEventLog(): readonly LmLogEntry[] {
    return entries;
}

// DevTools / Playwright hook: window.__lmLog.entries, window.__lmLog.dump().
declare global {
    interface Window {
        __lmLog?: { entries: readonly LmLogEntry[]; dump: () => string };
    }
}
if (typeof window !== 'undefined') {
    window.__lmLog = {
        entries,
        dump: () => entries.map((e) => `${String(e.t).padStart(8)}ms [${e.scope}] ${e.event}${e.data !== undefined ? ' ' + JSON.stringify(e.data) : ''}`).join('\n'),
    };
}

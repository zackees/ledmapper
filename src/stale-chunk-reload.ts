/**
 * Stale-chunk auto-reload — issue #447.
 *
 * Every deploy fully replaces the published asset set (content-hashed chunks,
 * `emptyOutDir: true`), so an already-open tab 404s on the next lazy
 * `import()` after a redeploy. Vite dispatches `vite:preloadError` on
 * `window` whenever a built dynamic import fails to load its chunk; the
 * documented recovery (https://vite.dev/guide/build.html#load-error-handling)
 * is to reload so the tab picks up the fresh `index.html` + hashes.
 *
 * Reload-loop guard: if this tab already auto-reloaded within the last
 * `STALE_RELOAD_WINDOW_MS` (stamp in sessionStorage — per-tab, survives the
 * reload, expires with the tab), the chunk is still missing after a fresh
 * load — a genuine outage, not staleness. In that case do NOT reload and do
 * NOT `preventDefault()`: let the rejection flow to the existing route-error
 * paths (router.ts / app.ts). An in-memory flag additionally caps it at one
 * auto-reload per page lifetime even when sessionStorage is unavailable.
 *
 * Injectable factory in the `src/watchdogs.ts` style — clock, storage,
 * reload, and logger are injected so the guard logic is unit-testable under
 * plain Node (tests/unit/stale-chunk-reload.test.ts).
 */

import { createLogger, type Logger } from './debug-log';

export const STALE_RELOAD_STAMP_KEY = 'lm:stale-reload-at';
export const STALE_RELOAD_WINDOW_MS = 60_000;

export interface StaleChunkReloadDeps {
    /** Wall-clock ms (Date.now) — the stamp must be comparable across the reload. */
    now: () => number;
    readStamp: () => string | null;
    writeStamp: (value: string) => void;
    reload: () => void;
    log: Logger;
}

/** Extract the failing import's error message from the event's `payload`
 *  (Vite attaches the underlying Error there). */
function payloadMessage(event: Event): string {
    const payload = (event as { payload?: unknown }).payload;
    if (payload instanceof Error) return payload.message;
    return typeof payload === 'string' ? payload : 'unknown';
}

export function createStaleChunkReloadHandler(deps: StaleChunkReloadDeps): (event: Event) => void {
    let reloadedThisPage = false;

    return function onPreloadError(event: Event): void {
        const error = payloadMessage(event);
        const t = deps.now();

        // A throwing readStamp (storage unavailable) means "no stamp" — the
        // in-memory flag still caps this page at one auto-reload.
        let stampMs: number | null = null;
        try {
            const raw = deps.readStamp();
            const parsed = raw === null ? NaN : Number(raw);
            if (Number.isFinite(parsed)) stampMs = parsed;
        } catch { /* treat as absent */ }

        const withinWindow = stampMs !== null && t - stampMs < STALE_RELOAD_WINDOW_MS;
        if (reloadedThisPage || withinWindow) {
            deps.log.warn('stale-deploy-reload-suppressed', {
                error,
                msSinceLastReload: stampMs === null ? null : t - stampMs,
            });
            return; // no preventDefault, no reload — surface through the route-error paths
        }

        reloadedThisPage = true;
        try { deps.writeStamp(String(t)); } catch { /* storage unavailable — in-memory flag still caps */ }
        deps.log.warn('stale-deploy-reload', { error });
        event.preventDefault(); // suppress the underlying import() rejection
        deps.reload();
    };
}

/** Wire the handler with real dependencies. Raw sessionStorage in try/catch
 *  (the `spa-redirect` convention in main.ts) — NOT services/storage.ts's
 *  safeStorage, which is localStorage-scoped; this guard must be per-tab. */
export function installStaleChunkReload(): void {
    const handler = createStaleChunkReloadHandler({
        now: () => Date.now(),
        readStamp: () => {
            try { return sessionStorage.getItem(STALE_RELOAD_STAMP_KEY); } catch { return null; }
        },
        writeStamp: (value) => {
            try { sessionStorage.setItem(STALE_RELOAD_STAMP_KEY, value); } catch { /* ignore */ }
        },
        reload: () => { location.reload(); },
        log: createLogger('boot'),
    });
    window.addEventListener('vite:preloadError', handler);
}

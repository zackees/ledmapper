/**
 * Copy-diagnostics payload builder (issue #230).
 *
 * `errorDialog()` in `src/ui/dialogs.ts` is the single choke point every
 * user-facing error routes through. This module builds the paste-ready
 * markdown blob its "Copy diagnostics" button copies to the clipboard —
 * the same idea as VS Code's "Report Issue" / Firefox's `about:support`,
 * scoped down to what actually helps reproduce a bug in this app.
 *
 * DOM-tolerant by design: every `window` / `navigator` / `location` /
 * `document` / `localStorage` access is guarded by a `typeof` check or
 * try/catch so this module can be unit-tested under plain Node (see
 * `tests/unit/diagnostics.test.ts`, which stubs those globals the same way
 * `tests/unit/debug-log.test.ts` does).
 *
 * Privacy: only localStorage KEY NAMES + byte lengths are included, never
 * values. The route is `location.pathname` only — no query string or hash,
 * since either could carry a repro-specific query param a user wouldn't
 * want pasted into a public GitHub issue verbatim (values, not just shape,
 * could leak there).
 */

/** GitHub's comment body limit is 65,536 chars; cap comfortably under that
 *  so the payload is always safe to paste (and stays readable). */
export const MAX_PAYLOAD_BYTES = 16 * 1024;

/** Only the tail of the event log is included — the events nearest the
 *  triggering error are the ones worth reading. */
export const LOG_TAIL_BYTES = 8 * 1024;

const TRUNCATION_MARKER = '\n… [truncated to fit size cap] …\n';

export interface DiagnosticsError {
    title: string;
    message: string;
}

/** Minimal shape of the `window.__lmLog` hook installed by `src/debug-log.ts`. */
interface LmLogWindow {
    __lmLog?: { dump: () => string };
}

/** `window.__lmDebug` is a state-snapshot registry that ships in a
 *  separate issue — this module must not create it, only read it if
 *  present. Kept as `unknown` since its shape isn't owned here. */
interface LmDebugWindow {
    __lmDebug?: unknown;
}

function getAppVersion(): string {
    // __APP_VERSION__ is a Vite `define` (vite.config.js) — a literal string
    // substituted at build/dev-server time, not a real runtime binding.
    // Under plain Node (unit tests, no Vite processing) the identifier is
    // never declared; `typeof` never throws on an unresolved identifier, so
    // this stays safe in both environments.
    return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown';
}

function getPathname(): string {
    try {
        return typeof location !== 'undefined' ? location.pathname : 'unknown';
    } catch {
        return 'unknown';
    }
}

function getUserAgent(): string {
    try {
        return typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
    } catch {
        return 'unknown';
    }
}

function getPlatform(): string {
    try {
        return typeof navigator !== 'undefined' ? navigator.platform : 'unknown';
    } catch {
        return 'unknown';
    }
}

function getViewport(): string {
    try {
        if (typeof window === 'undefined') return 'unknown';
        return `${String(window.innerWidth)}x${String(window.innerHeight)}`;
    } catch {
        return 'unknown';
    }
}

function getDevicePixelRatio(): string {
    try {
        return typeof window !== 'undefined' ? String(window.devicePixelRatio) : 'unknown';
    } catch {
        return 'unknown';
    }
}

/** GPU renderer string via `WEBGL_debug_renderer_info`, falling back to the
 *  masked `gl.getParameter(gl.RENDERER)` when the debug extension isn't
 *  exposed (some browsers gate it behind a flag/permission). A throwaway
 *  canvas + context is created purely to query this — never attached to
 *  the DOM, never rendered to. Fully try/catch-guarded: WebGL support
 *  varies wildly and none of this should ever break the error dialog it's
 *  reporting from. */
function getGpuRenderer(): string {
    try {
        if (typeof document === 'undefined') return 'unavailable';
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        if (!gl) return 'unavailable';

        try {
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            if (ext) {
                const unmasked = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
                if (unmasked.length > 0 && unmasked !== 'undefined') return unmasked;
            }
        } catch {
            // fall through to the masked getParameter fallback below
        }

        try {
            const masked = String(gl.getParameter(gl.RENDERER));
            return masked.length > 0 && masked !== 'undefined' ? masked : 'unavailable';
        } catch {
            return 'unavailable';
        }
    } catch {
        return 'unavailable';
    }
}

function getLmDebugSnapshot(): string | null {
    try {
        if (typeof window === 'undefined') return null;
        const snap = (window as unknown as LmDebugWindow).__lmDebug;
        if (snap === undefined) return null;
        return JSON.stringify(snap, null, 2);
    } catch {
        return '(unavailable)';
    }
}

function encodedByteLength(s: string): number {
    try {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    } catch {
        // fall through to the UTF-16 length approximation below
    }
    return s.length;
}

/** Key names + byte lengths only — never values. */
function getLocalStorageSummary(): string[] {
    try {
        if (typeof localStorage === 'undefined') return [];
        const out: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key === null) continue;
            const value = localStorage.getItem(key) ?? '';
            out.push(`${key}: ${String(encodedByteLength(value))} bytes`);
        }
        return out;
    } catch {
        return [];
    }
}

function getLogTail(): string {
    try {
        if (typeof window === 'undefined') return '(no log)';
        const dump = (window as unknown as LmLogWindow).__lmLog?.dump();
        if (typeof dump !== 'string' || dump.length === 0) return '(no log)';
        if (dump.length <= LOG_TAIL_BYTES) return dump;
        return `… [showing last ${String(LOG_TAIL_BYTES)} chars] …\n${dump.slice(dump.length - LOG_TAIL_BYTES)}`;
    } catch {
        return '(log unavailable)';
    }
}

function capToLength(s: string, maxLen: number): string {
    if (s.length <= maxLen) return s;
    const keep = Math.max(0, maxLen - TRUNCATION_MARKER.length);
    return s.slice(0, keep) + TRUNCATION_MARKER;
}

function wrap(body: string): string {
    return `<details><summary>Diagnostics</summary>\n\n\`\`\`text\n${body}\n\`\`\`\n\n</details>`;
}

function buildBody(error: DiagnosticsError): string {
    const lines: string[] = [];
    lines.push(`App version: ${getAppVersion()}`);
    lines.push(`Route: ${getPathname()}`);
    lines.push(`User agent: ${getUserAgent()}`);
    lines.push(`Platform: ${getPlatform()}`);
    lines.push(`Viewport: ${getViewport()}`);
    lines.push(`Device pixel ratio: ${getDevicePixelRatio()}`);
    lines.push(`GPU renderer: ${getGpuRenderer()}`);
    lines.push('');
    lines.push(`Error: ${error.title}`);
    lines.push(error.message);

    const lmDebug = getLmDebugSnapshot();
    if (lmDebug !== null) {
        lines.push('');
        lines.push('window.__lmDebug:');
        lines.push(lmDebug);
    }

    lines.push('');
    lines.push('localStorage (key: byte length; values never included):');
    const storage = getLocalStorageSummary();
    if (storage.length === 0) lines.push('(empty)');
    else lines.push(...storage);

    lines.push('');
    lines.push('Event log (tail):');
    lines.push(getLogTail());

    return lines.join('\n');
}

/**
 * Build the full markdown diagnostics payload: `<details>`-wrapped,
 * fenced, capped to ~`MAX_PAYLOAD_BYTES`. Fully synchronous — every data
 * source it reads is synchronous (canvas/WebGL, localStorage, the
 * `__lmLog` ring buffer).
 */
export function buildDiagnosticsPayload(error: DiagnosticsError): string {
    const body = buildBody(error);
    const overhead = wrap('').length;
    const maxBodyLen = Math.max(0, MAX_PAYLOAD_BYTES - overhead);
    return wrap(capToLength(body, maxBodyLen));
}

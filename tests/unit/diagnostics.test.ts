/**
 * Unit tests for `src/ui/diagnostics.ts` — the Copy-diagnostics payload
 * builder behind `errorDialog()`'s footer button (issue #230).
 *
 * Stubs `localStorage`, `window`, `location`, and `navigator` on
 * `globalThis` before importing the module (same pattern as
 * `tests/unit/debug-log.test.ts`). The module reads all of these as bare
 * globals guarded by `typeof` checks or try/catch, so it stays import-safe
 * — and, with the stubs installed, fully exercisable — under plain Node.
 */

import { test, describe, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

class MockLocalStorage {
    private store = new Map<string, string>();
    get length(): number { return this.store.size; }
    key(i: number): string | null { return Array.from(this.store.keys())[i] ?? null; }
    getItem(key: string): string | null { return this.store.get(key) ?? null; }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear(): void { this.store.clear(); }
}

interface FakeLmLog { dump: () => string }

class FakeWindow {
    innerWidth = 1024;
    innerHeight = 768;
    devicePixelRatio = 2;
    __lmLog: FakeLmLog | undefined = undefined;
    __lmDebug: unknown = undefined;
}

const mockStorage = new MockLocalStorage();
const fakeWindow = new FakeWindow();

/** Node 21+ ships a read-only global `navigator` getter (Web-platform API
 *  parity), so a plain assignment throws — redefine the property instead,
 *  same as swapping out any other global for the test double. */
function setGlobal(name: string, value: unknown): void {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

setGlobal('localStorage', mockStorage);
setGlobal('window', fakeWindow);
setGlobal('location', { pathname: '/moviemaker/', search: '?foo=bar', hash: '#baz' });
setGlobal('navigator', { userAgent: 'test-agent/1.0', platform: 'TestPlatform' });

const { buildDiagnosticsPayload, MAX_PAYLOAD_BYTES, LOG_TAIL_BYTES } =
    await import('../../src/ui/diagnostics');

beforeEach(() => {
    mockStorage.clear();
    fakeWindow.__lmLog = undefined;
    fakeWindow.__lmDebug = undefined;
});

describe('payload structure', () => {
    test('wraps the body in <details><summary>Diagnostics</summary> + a fenced text block', () => {
        const payload = buildDiagnosticsPayload({ title: 'Boom', message: 'Something broke' });
        assert.match(payload, /^<details><summary>Diagnostics<\/summary>/);
        assert.match(payload, /```text\n/);
        assert.match(payload, /\n```\n\n<\/details>$/);
    });

    test('includes the app version, GPU renderer, and viewport fields', () => {
        const payload = buildDiagnosticsPayload({ title: 'Boom', message: 'Something broke' });
        assert.match(payload, /App version: unknown/); // no Vite `define` under plain Node
        assert.match(payload, /GPU renderer: unavailable/); // no document/canvas under plain Node
        assert.match(payload, /Viewport: 1024x768/);
        assert.match(payload, /Device pixel ratio: 2/);
    });

    test('includes the triggering error title and message', () => {
        const payload = buildDiagnosticsPayload({ title: 'Load failed', message: 'no embedded screenmap' });
        assert.match(payload, /Error: Load failed/);
        assert.match(payload, /no embedded screenmap/);
    });

    test('includes window.__lmDebug only when present', () => {
        const withoutDebug = buildDiagnosticsPayload({ title: 'T', message: 'M' });
        assert.doesNotMatch(withoutDebug, /__lmDebug/);

        fakeWindow.__lmDebug = { screenmapLoaded: false };
        const withDebug = buildDiagnosticsPayload({ title: 'T', message: 'M' });
        assert.match(withDebug, /window\.__lmDebug:/);
        assert.match(withDebug, /"screenmapLoaded": false/);
    });

    test('includes the tail of window.__lmLog.dump() when present', () => {
        fakeWindow.__lmLog = { dump: () => '10ms [info] [test] something-happened' };
        const payload = buildDiagnosticsPayload({ title: 'T', message: 'M' });
        assert.match(payload, /something-happened/);
    });

    test('reports "(no log)" when window.__lmLog is absent', () => {
        const payload = buildDiagnosticsPayload({ title: 'T', message: 'M' });
        assert.match(payload, /\(no log\)/);
    });
});

describe('pathname-only route', () => {
    test('includes location.pathname but never the query string or hash', () => {
        const payload = buildDiagnosticsPayload({ title: 'T', message: 'M' });
        assert.match(payload, /Route: \/moviemaker\//);
        assert.doesNotMatch(payload, /foo=bar/);
        assert.doesNotMatch(payload, /#baz/);
    });
});

describe('localStorage redaction', () => {
    test('includes key names + byte lengths, never values', () => {
        mockStorage.setItem('lm:log', 'debug');
        mockStorage.setItem('auth-token', 'super-secret-value-do-not-leak');
        const payload = buildDiagnosticsPayload({ title: 'T', message: 'M' });

        assert.match(payload, /lm:log: 5 bytes/);
        assert.match(payload, /auth-token: 30 bytes/);
        assert.doesNotMatch(payload, /super-secret-value-do-not-leak/);
    });

    test('reports "(empty)" when localStorage has no keys', () => {
        const payload = buildDiagnosticsPayload({ title: 'T', message: 'M' });
        assert.match(payload, /\(empty\)/);
    });
});

describe('size cap', () => {
    test('caps the total payload to roughly MAX_PAYLOAD_BYTES even with a huge log dump', () => {
        const hugeDump = 'x'.repeat(LOG_TAIL_BYTES * 4);
        fakeWindow.__lmLog = { dump: () => hugeDump };
        const payload = buildDiagnosticsPayload({ title: 'T', message: 'M' });

        // The log tail alone is already clamped to LOG_TAIL_BYTES by the
        // module before the overall payload cap is applied, so the total
        // payload must land well within MAX_PAYLOAD_BYTES plus a small
        // fixed markdown-wrapper overhead.
        assert.ok(
            payload.length <= MAX_PAYLOAD_BYTES + 128,
            `payload length ${String(payload.length)} exceeds the size cap`,
        );
    });

    test('truncates and marks huge localStorage listings rather than growing unbounded', () => {
        for (let i = 0; i < 2000; i++) {
            mockStorage.setItem(`key-${String(i)}`, 'x'.repeat(50));
        }
        const payload = buildDiagnosticsPayload({ title: 'T', message: 'M' });
        assert.ok(payload.length <= MAX_PAYLOAD_BYTES + 128);
        assert.match(payload, /truncated/);
    });
});

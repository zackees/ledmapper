/**
 * Unit tests for `src/debug-log.ts` — level gating, ring-buffer eviction,
 * `createLogger` scoping, dump format, global error capture, and the
 * `?lmlog=` query-param -> localStorage persistence.
 *
 * Stubs `localStorage`, `window`, and `location` on `globalThis` before
 * importing the module (see `tests/unit/storage.test.ts` for the same
 * pattern). The module reads `localStorage`/`window`/`location` as bare
 * globals guarded by try/catch or `typeof` checks, so it stays import-safe
 * under plain Node.
 */

import { test, describe, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import type { LmLogEntry } from '../../src/debug-log';

/** `entries[0]` under `noUncheckedIndexedAccess` is `T | undefined`;
 *  `assert.ok` has a TS assertion signature, so this narrows the result to
 *  `T` for the rest of the test instead of repeating `?.` everywhere. */
function first(entries: readonly LmLogEntry[]): LmLogEntry {
    const entry = entries[0];
    assert.ok(entry, 'expected at least one entry');
    return entry;
}

class MockLocalStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null { return this.store.get(key) ?? null; }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear(): void { this.store.clear(); }
}

/** Cache-bust a dynamic import of debug-log so it gets a fresh module
 *  instance (re-running the module's top-level query-param sync) instead of
 *  the cached instance imported at the top of this file. A non-literal
 *  specifier keeps TS from trying (and failing) to statically resolve the
 *  synthetic query string. */
function importFreshDebugLog(cacheBustSuffix: string): Promise<unknown> {
    const specifier = '../../src/debug-log?' + cacheBustSuffix;
    return import(specifier);
}

type Handler = (event: unknown) => void;

/** Minimal stand-in for `window`: just enough `addEventListener` to let the
 *  module's global-capture wiring register and for tests to fire events. */
class FakeWindow {
    private listeners = new Map<string, Handler[]>();
    __lmLog?: { entries: readonly unknown[]; dump: () => string };
    addEventListener(type: string, handler: Handler): void {
        const arr = this.listeners.get(type) ?? [];
        arr.push(handler);
        this.listeners.set(type, arr);
    }
    emit(type: string, event: unknown): void {
        for (const handler of this.listeners.get(type) ?? []) handler(event);
    }
}

const mockStorage = new MockLocalStorage();
const fakeWindow = new FakeWindow();
(globalThis as unknown as { localStorage: MockLocalStorage }).localStorage = mockStorage;
(globalThis as unknown as { window: FakeWindow }).window = fakeWindow;
(globalThis as unknown as { location: { search: string } }).location = { search: '' };

// Import AFTER the globals are installed — the module wires up
// window.__lmLog and the global error/rejection listeners at import time.
const { createLogger, logEvent, getEventLog, parseLevelFromQueryString, _resetLogForTests } =
    await import('../../src/debug-log');

beforeEach(() => {
    mockStorage.clear();
    _resetLogForTests();
});

describe('parseLevelFromQueryString', () => {
    test('parses each valid level', () => {
        assert.equal(parseLevelFromQueryString('?lmlog=debug'), 'debug');
        assert.equal(parseLevelFromQueryString('?lmlog=info'), 'info');
        assert.equal(parseLevelFromQueryString('?lmlog=warn'), 'warn');
        assert.equal(parseLevelFromQueryString('?lmlog=error'), 'error');
    });

    test('returns null when the param is absent or invalid', () => {
        assert.equal(parseLevelFromQueryString(''), null);
        assert.equal(parseLevelFromQueryString('?other=1'), null);
        assert.equal(parseLevelFromQueryString('?lmlog=verbose'), null);
    });
});

describe('level gating', () => {
    test('default level (no override, no DEV build) is info: debug dropped, info kept', () => {
        const log = createLogger('test');
        log.debug('d-event');
        log.info('i-event');
        const entries = getEventLog();
        assert.equal(entries.length, 1);
        const entry = first(entries);
        assert.equal(entry.event, 'i-event');
        assert.equal(entry.level, 'info');
    });

    test('localStorage override to "debug" lets debug entries through', () => {
        mockStorage.setItem('lm:log', 'debug');
        const log = createLogger('test');
        log.debug('d-event');
        const entries = getEventLog();
        assert.equal(entries.length, 1);
        assert.equal(first(entries).level, 'debug');
    });

    test('an invalid localStorage value falls back to the default level', () => {
        mockStorage.setItem('lm:log', 'verbose');
        const log = createLogger('test');
        log.debug('d-event');
        assert.equal(getEventLog().length, 0);
    });

    test('warn/error are always recorded even when the active level is narrowed to error', () => {
        mockStorage.setItem('lm:log', 'error');
        const log = createLogger('test');
        log.debug('d-event');
        log.info('i-event');
        log.warn('w-event');
        log.error('e-event');
        const events = getEventLog().map((e) => e.event);
        assert.deepEqual(events, ['w-event', 'e-event']);
    });
});

describe('createLogger scoping', () => {
    test('binds the scope across all four methods', () => {
        const log = createLogger('my-scope');
        mockStorage.setItem('lm:log', 'debug');
        log.debug('a');
        log.info('b');
        log.warn('c');
        log.error('d');
        const entries = getEventLog();
        assert.equal(entries.length, 4);
        assert.ok(entries.every((e) => e.scope === 'my-scope'));
    });
});

describe('logEvent', () => {
    test('keeps working unchanged: records at info level under the given scope', () => {
        logEvent('legacy', 'thing-happened', { x: 1 });
        const entries = getEventLog();
        assert.equal(entries.length, 1);
        const entry = first(entries);
        assert.equal(entry.scope, 'legacy');
        assert.equal(entry.event, 'thing-happened');
        assert.equal(entry.level, 'info');
        assert.deepEqual(entry.data, { x: 1 });
    });
});

describe('ring buffer eviction', () => {
    test('caps at 500 entries, evicting the oldest first', () => {
        const log = createLogger('flood');
        for (let i = 0; i < 550; i++) log.warn('event', { i });
        const entries = getEventLog();
        assert.equal(entries.length, 500);
        const last = entries[entries.length - 1];
        assert.ok(last);
        assert.equal((first(entries).data as { i: number }).i, 50);
        assert.equal((last.data as { i: number }).i, 549);
    });
});

describe('window.__lmLog', () => {
    test('dump() format includes the level alongside timestamp/scope/event', () => {
        const log = createLogger('dumpscope');
        log.warn('dump-event', { k: 'v' });
        const dump = fakeWindow.__lmLog?.dump();
        assert.ok(dump);
        assert.match(dump, /^\s*\d+ms \[warn] \[dumpscope] dump-event \{"k":"v"}$/);
    });

    test('entries is a live reference to the same buffer getEventLog() returns', () => {
        assert.equal(fakeWindow.__lmLog?.entries, getEventLog());
    });
});

describe('global error capture', () => {
    test('a window "error" event is recorded as an error entry with a stack head', () => {
        fakeWindow.emit('error', { message: 'Boom', error: new Error('Boom') });
        const entries = getEventLog();
        assert.equal(entries.length, 1);
        const entry = first(entries);
        assert.equal(entry.scope, 'window');
        assert.equal(entry.event, 'onerror');
        assert.equal(entry.level, 'error');
        const data = entry.data as { message: string };
        assert.equal(data.message, 'Boom');
    });

    test('an "unhandledrejection" event is recorded as an error entry', () => {
        fakeWindow.emit('unhandledrejection', { reason: new Error('rejected') });
        const entries = getEventLog();
        assert.equal(entries.length, 1);
        const entry = first(entries);
        assert.equal(entry.scope, 'window');
        assert.equal(entry.event, 'unhandledrejection');
        assert.equal(entry.level, 'error');
    });

    test('a non-Error rejection reason is stringified without a stack', () => {
        fakeWindow.emit('unhandledrejection', { reason: 'plain string reason' });
        const entries = getEventLog();
        const data = first(entries).data as { message: string; stack?: string };
        assert.equal(data.message, 'plain string reason');
        assert.equal(data.stack, undefined);
    });
});

describe('query-param level persists to localStorage on load', () => {
    test('a fresh module instance loaded with "?lmlog=debug" in location.search persists "debug"', async () => {
        (globalThis as unknown as { location: { search: string } }).location = { search: '?lmlog=debug' };
        mockStorage.clear();
        await importFreshDebugLog('query-param-test-1');
        assert.equal(mockStorage.getItem('lm:log'), 'debug');
    });

    test('a later load with a different query value overwrites the persisted level', async () => {
        (globalThis as unknown as { location: { search: string } }).location = { search: '?lmlog=warn' };
        mockStorage.clear();
        await importFreshDebugLog('query-param-test-2');
        assert.equal(mockStorage.getItem('lm:log'), 'warn');
    });

    test('no query param leaves an existing persisted level untouched', async () => {
        (globalThis as unknown as { location: { search: string } }).location = { search: '' };
        mockStorage.clear();
        mockStorage.setItem('lm:log', 'error');
        await importFreshDebugLog('query-param-test-3');
        assert.equal(mockStorage.getItem('lm:log'), 'error');
    });
});

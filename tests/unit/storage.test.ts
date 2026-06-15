/**
 * Unit tests for `safeStorage` + `withPrefix`.
 *
 * Pure logic plus a stubbed `localStorage`. Each test resets the global
 * stub so they stay independent.
 */

import { test, describe, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

class MockLocalStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null { return this.store.get(key) ?? null; }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear() { this.store.clear(); }
    snapshot(): Record<string, string> { return Object.fromEntries(this.store); }
}

const mock = new MockLocalStorage();
(globalThis as unknown as { localStorage: MockLocalStorage }).localStorage = mock;

// Import AFTER the global is installed.
const { safeStorage, withPrefix } = await import('../../src/services/storage');

beforeEach(() => { mock.clear(); });

describe('safeStorage — strings', () => {
    test('get returns null when the key is missing', () => {
        assert.equal(safeStorage.get('absent'), null);
    });

    test('round-trip via set / get', () => {
        assert.equal(safeStorage.set('k', 'v'), true);
        assert.equal(safeStorage.get('k'), 'v');
    });

    test('remove clears the key', () => {
        safeStorage.set('k', 'v');
        safeStorage.remove('k');
        assert.equal(safeStorage.get('k'), null);
    });
});

describe('safeStorage — booleans', () => {
    test('getBool returns the default when missing', () => {
        assert.equal(safeStorage.getBool('b', true), true);
        assert.equal(safeStorage.getBool('b', false), false);
    });

    test('reads new-format "true"/"false"', () => {
        safeStorage.set('b', 'true');
        assert.equal(safeStorage.getBool('b', false), true);
        safeStorage.set('b', 'false');
        assert.equal(safeStorage.getBool('b', true), false);
    });

    test('reads legacy "1"/"0" so shapeeditor flags keep working', () => {
        safeStorage.set('b', '1');
        assert.equal(safeStorage.getBool('b', false), true);
        safeStorage.set('b', '0');
        assert.equal(safeStorage.getBool('b', true), false);
    });

    test('setBool writes "true"/"false"', () => {
        safeStorage.setBool('b', true);
        assert.equal(safeStorage.get('b'), 'true');
        safeStorage.setBool('b', false);
        assert.equal(safeStorage.get('b'), 'false');
    });
});

describe('safeStorage — JSON', () => {
    test('round-trip via setJson / getJson', () => {
        safeStorage.setJson('j', { a: 1, b: [2, 3] });
        assert.deepEqual(safeStorage.getJson('j'), { a: 1, b: [2, 3] });
    });

    test('getJson returns null on malformed JSON', () => {
        safeStorage.set('j', '{not json');
        assert.equal(safeStorage.getJson('j'), null);
    });

    test('getJson returns null when the key is missing', () => {
        assert.equal(safeStorage.getJson('missing'), null);
    });
});

describe('withPrefix', () => {
    test('reads and writes through the underlying namespace', () => {
        const store = withPrefix('foo.');
        store.set('bar', 'baz');
        assert.equal(safeStorage.get('foo.bar'), 'baz');
        assert.equal(store.get('bar'), 'baz');
    });

    test('boolean and JSON delegation', () => {
        const store = withPrefix('ns:');
        store.setBool('flag', true);
        store.setJson('blob', { x: 1 });
        assert.equal(safeStorage.get('ns:flag'), 'true');
        assert.deepEqual(safeStorage.getJson('ns:blob'), { x: 1 });
    });

    test('remove through the prefix', () => {
        const store = withPrefix('ns.');
        store.set('k', 'v');
        store.remove('k');
        assert.equal(safeStorage.get('ns.k'), null);
    });
});

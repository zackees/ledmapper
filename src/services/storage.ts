/**
 * `safeStorage` — a tiny try/catch wrapper around `localStorage` so callers
 * don't have to repeat the same defensive boilerplate.
 *
 * Every read returns `null` (or the supplied default) if storage is
 * unavailable or the value is missing. Every write returns a boolean: `true`
 * if the value was persisted, `false` if a quota / permission error swallowed
 * it. The wrapper never throws.
 *
 * Issue #119 Phase 5a — consolidates ~25 ad-hoc `try { localStorage.… } catch
 * { /* ignore *\/ }` blocks scattered across `screenmap-store.ts`,
 * `bloom-ui.ts`, the shape-editor methods files, and `moviemaker.ts`.
 *
 * **The wrapper does NOT change any persisted keys.** Migrating a call site
 * to `safeStorage` is byte-for-byte compatible with the prior raw
 * `localStorage` call — user state survives the refactor.
 */

function rawGet(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
}

function rawSet(key: string, value: string): boolean {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
}

function rawRemove(key: string): void {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export interface SafeStorage {
    /** Read a string. Returns `null` if the key is missing or storage is unavailable. */
    get(key: string): string | null;
    /** Write a string. Returns `true` on success, `false` if storage rejected it. */
    set(key: string, value: string): boolean;
    /** Delete a key. No-op if it doesn't exist or storage is unavailable. */
    remove(key: string): void;
    /**
     * Read and JSON-parse a value. Returns `null` on miss or parse error.
     * Callers cast the result to their expected shape, e.g.
     * `safeStorage.getJson('foo') as MyType | null`.
     */
    getJson(key: string): unknown;
    /** JSON-stringify and write a value. Returns `false` on serialization or quota failure. */
    setJson(key: string, value: unknown): boolean;
    /**
     * Read a boolean stored as `'true'` / `'false'` or `'1'` / `'0'`. Returns
     * `defaultValue` when the key is missing.
     */
    getBool(key: string, defaultValue: boolean): boolean;
    /** Write a boolean as `'true'` / `'false'`. */
    setBool(key: string, value: boolean): boolean;
}

export const safeStorage: SafeStorage = {
    get: rawGet,
    set: rawSet,
    remove: rawRemove,
    getJson(key: string): unknown {
        const raw = rawGet(key);
        if (raw === null) return null;
        try { return JSON.parse(raw) as unknown; } catch { return null; }
    },
    setJson(key: string, value: unknown): boolean {
        try { return rawSet(key, JSON.stringify(value)); } catch { return false; }
    },
    getBool(key: string, defaultValue: boolean): boolean {
        const raw = rawGet(key);
        if (raw === null) return defaultValue;
        return raw === 'true' || raw === '1';
    },
    setBool(key: string, value: boolean): boolean {
        return rawSet(key, value ? 'true' : 'false');
    },
};

/**
 * Bind every `safeStorage` method to a fixed key prefix so call sites can
 * focus on the suffix.
 *
 *   const store = withPrefix('shapeeditor.');
 *   store.getBool('snapBackEnabled', true);   // -> localStorage 'shapeeditor.snapBackEnabled'
 *
 * The prefix is concatenated as-is — pass any trailing separator (`.`, `-`,
 * `:`) the existing keys already use so persisted state stays compatible.
 */
export function withPrefix(prefix: string): SafeStorage {
    return {
        get: (key) => safeStorage.get(prefix + key),
        set: (key, value) => safeStorage.set(prefix + key, value),
        remove: (key) => { safeStorage.remove(prefix + key); },
        getJson: (key) => safeStorage.getJson(prefix + key),
        setJson: (key, value) => safeStorage.setJson(prefix + key, value),
        getBool: (key, defaultValue) => safeStorage.getBool(prefix + key, defaultValue),
        setBool: (key, value) => safeStorage.setBool(prefix + key, value),
    };
}

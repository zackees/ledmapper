/**
 * Minimal hand-rolled reactive signals (~1KB) — the #72 ergonomics primitive.
 *
 * A `signal` is a value that tracks which `effect`s read it and re-runs them
 * when it changes, so UI state gets one owner instead of N manual "when X
 * changes, also update Y and Z" sync sites. No framework, no dependency.
 *
 * Deliberately tiny: synchronous (effects run inline on `.set`), no batching,
 * no computed/memo. That is enough for control-panel glue; reach for a real
 * library if this ever needs async scheduling or large dependency graphs.
 */

interface Subscriber {
    run: () => void;
    /** Subscriber-sets this effect is currently registered in, for disposal. */
    deps: Set<Set<Subscriber>>;
}

/** The effect currently running, so reads can register it as a subscriber. */
let activeEffect: Subscriber | null = null;

export interface Signal<T> {
    /** Read the value, subscribing the running effect (if any). */
    get(): T;
    /** Write the value; re-runs subscribed effects when it actually changes. */
    set(next: T): void;
    /** Read without subscribing — for an effect that shouldn't depend on it. */
    peek(): T;
}

/** Create a reactive value. Effects that `get()` it re-run when it changes. */
export function signal<T>(initial: T): Signal<T> {
    let value = initial;
    const subscribers = new Set<Subscriber>();
    return {
        get() {
            if (activeEffect) {
                subscribers.add(activeEffect);
                activeEffect.deps.add(subscribers);
            }
            return value;
        },
        peek() {
            return value;
        },
        set(next: T) {
            if (Object.is(next, value)) return;
            value = next;
            // Snapshot: a re-running effect may re-subscribe, mutating the set.
            for (const sub of [...subscribers]) sub.run();
        },
    };
}

/**
 * Run `fn` immediately and re-run it whenever any signal it read changes.
 * Returns a disposer that detaches the effect from every signal it subscribed to.
 */
export function effect(fn: () => void): () => void {
    const sub: Subscriber = {
        deps: new Set(),
        run() {
            // Drop stale subscriptions so conditional reads don't leak.
            for (const set of sub.deps) set.delete(sub);
            sub.deps.clear();
            const prev = activeEffect;
            activeEffect = sub;
            try {
                fn();
            } finally {
                activeEffect = prev;
            }
        },
    };
    sub.run();
    return () => {
        for (const set of sub.deps) set.delete(sub);
        sub.deps.clear();
    };
}

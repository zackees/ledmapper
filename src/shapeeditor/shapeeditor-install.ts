const installedBundles = new WeakMap<object, Map<string, object>>();

export function installShapeEditorMethodBundle(prototype: object, owner: string, bundle: object): void {
    let owners = installedBundles.get(prototype);
    if (!owners) {
        owners = new Map();
        installedBundles.set(prototype, owners);
    }

    const previous = owners.get(owner);
    if (previous === bundle) return;
    if (previous) throw new Error(`ShapeEditor bundle "${owner}" was already installed with a different object`);

    const entries: [string, unknown][] = [];
    for (const key of Reflect.ownKeys(bundle)) {
        if (typeof key !== 'string') throw new Error(`ShapeEditor bundle "${owner}" has a non-string method key`);
        const value: unknown = Reflect.get(bundle, key);
        if (typeof value !== 'function') throw new Error(`ShapeEditor bundle "${owner}" method "${key}" is not a function`);
        if (Object.prototype.hasOwnProperty.call(prototype, key)) {
            throw new Error(`ShapeEditor method "${key}" is claimed more than once (owner: "${owner}")`);
        }
        entries.push([key, value]);
    }

    for (const [key, value] of entries) {
        Object.defineProperty(prototype, key, {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
        });
    }
    owners.set(owner, bundle);
}

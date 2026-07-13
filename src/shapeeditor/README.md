# ShapeEditor module architecture

`shapeeditor.ts` is the public entry point. `shapeeditor-init.ts` installs the constructor, `start`, and `destroy` lifecycle methods. The remaining editor behavior lives in named responsibility bundles (`editor-core.ts`, `editor-io.ts`, `editor-history.ts`, and the other `editor-*.ts` files).

Named modules are side-effect free: they export a method bundle and a type derived from that bundle. `shapeeditor-composition.ts` is the only module that imports every bundle and installs them on `ShapeEditor.prototype`. `shapeeditor-install.ts` makes installation idempotent and rejects duplicate method ownership.

When adding a method:

1. Put it in the one responsibility module that owns the behavior.
2. Keep the method name stable and add it to that bundle; cross-module calls go through `this`.
3. Keep runtime imports between owner modules out of the bundle. Use pure helpers or type-only imports instead.
4. Add or update the manifest/composition test and a focused behavior test.
5. Run `npm run lint`, `npm run test:fast`, and the relevant ShapeEditor integration specs.

The numbered `shapeeditor-methods-*.ts` files are retired. Do not recreate them; a new responsibility belongs in a named module.

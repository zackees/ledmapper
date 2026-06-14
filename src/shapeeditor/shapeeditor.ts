// Produced by a one-time mechanical refactor of shapeeditor.ts (see PR description).
// Public entry point: re-exports init() and CSS URL.

import { ShapeEditor } from './shapeeditor-class';
import './shapeeditor-init';
import './shapeeditor-methods-01';
import './shapeeditor-methods-02';
import './shapeeditor-methods-03';
import './shapeeditor-methods-04';
import './shapeeditor-methods-05';
import './shapeeditor-methods-06';
import './shapeeditor-methods-07';
import './shapeeditor-methods-08';

export { default as css } from './shapeeditor.css?url';

export function init(container: HTMLElement) {
    const editor = new ShapeEditor(container);
    editor.start();
    return () => editor.destroy();
}

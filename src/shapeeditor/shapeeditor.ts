// ShapeEditor public entry point.
import { ShapeEditor } from './shapeeditor-class';
import './shapeeditor-init';
import { installShapeEditorModules } from './shapeeditor-composition';

installShapeEditorModules();

export { default as css } from './shapeeditor.css?url';

export function init(container: HTMLElement) {
    const editor = new ShapeEditor(container);
    editor.start();
    return () => { editor.destroy(); };
}

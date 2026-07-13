import { ShapeEditor } from './shapeeditor-class';
import { installShapeEditorMethodBundle } from './shapeeditor-install';
import { editorBackgroundMethods } from './editor-background';
import { editorConnectorsMethods } from './editor-connectors';
import { editorCoreMethods } from './editor-core';
import { editorHelpMethods } from './editor-help';
import { editorHistoryMethods } from './editor-history';
import { editorInteractionMethods } from './editor-interaction';
import { editorIoMethods } from './editor-io';
import { editorOverlayMethods } from './editor-overlay';
import { editorPanelsMethods } from './editor-panels';
import { editorPasteMethods } from './editor-paste';
import { editorPointsMethods } from './editor-points';
import { editorRendererMethods } from './editor-renderer';
import { editorRulersMethods } from './editor-rulers';
import { editorStripsMethods } from './editor-strips';
import { editorTransformMethods } from './editor-transform';

const bundles = [
    ['core', editorCoreMethods],
    ['io', editorIoMethods],
    ['history', editorHistoryMethods],
    ['points', editorPointsMethods],
    ['strips', editorStripsMethods],
    ['connectors', editorConnectorsMethods],
    ['transform', editorTransformMethods],
    ['background', editorBackgroundMethods],
    ['rulers', editorRulersMethods],
    ['overlay', editorOverlayMethods],
    ['renderer', editorRendererMethods],
    ['interaction', editorInteractionMethods],
    ['help', editorHelpMethods],
    ['panels', editorPanelsMethods],
    ['paste', editorPasteMethods],
] as const;

export const shapeEditorMethodManifest = Object.freeze(
    Object.fromEntries(bundles.map(([owner, bundle]) => [owner, Object.freeze(Object.keys(bundle))])),
);

export function installShapeEditorModules(): void {
    for (const [owner, bundle] of bundles) installShapeEditorMethodBundle(ShapeEditor.prototype, owner, bundle);
}

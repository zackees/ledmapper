import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCommandRegistry, type EditorCommand } from '../../src/shapeeditor/editor-commands';

/** Mini button stub — enough to drive bind()/refresh() without a real DOM. */
function makeButton(): HTMLButtonElement {
    let disabled = false;
    let title = '';
    const handlers: (() => void)[] = [];
    const el = {
        get disabled() { return disabled; },
        set disabled(v: boolean) { disabled = v; },
        get title() { return title; },
        set title(v: string) { title = v; },
        addEventListener(_kind: string, fn: () => void) { handlers.push(fn); },
        click() { for (const h of handlers) h(); },
    };
    return el as unknown as HTMLButtonElement;
}

function makeCommand(overrides: Partial<EditorCommand> = {}): EditorCommand {
    return {
        id: 'save-as',
        label: 'Save As…',
        isEnabled: () => true,
        run: () => { /* no-op */ },
        ...overrides,
    };
}

test('register + isEnabled: reflects the command\'s current isEnabled()', () => {
    const registry = createCommandRegistry();
    let enabled = false;
    registry.register(makeCommand({ id: 'save-as', isEnabled: () => enabled }));
    assert.equal(registry.isEnabled('save-as'), false);
    enabled = true;
    assert.equal(registry.isEnabled('save-as'), true);
});

test('run: invokes run() only when the command is enabled', () => {
    const registry = createCommandRegistry();
    let enabled = false;
    let runCount = 0;
    registry.register(makeCommand({ id: 'undo', isEnabled: () => enabled, run: () => { runCount++; } }));
    registry.run('undo');
    assert.equal(runCount, 0, 'disabled command must not run');
    enabled = true;
    registry.run('undo');
    assert.equal(runCount, 1);
});

test('get: throws for an unregistered command id', () => {
    const registry = createCommandRegistry();
    assert.throws(() => { registry.get('redo'); }, /Unknown editor command "redo"/);
});

test('bind: wires click -> run(), sets initial disabled + tooltip, and a second bound control tracks independently', () => {
    const registry = createCommandRegistry();
    let enabled = false;
    let runCount = 0;
    registry.register(makeCommand({
        id: 'new', label: 'New', isEnabled: () => enabled, run: () => { runCount++; },
    }));
    const headerBtn = makeButton();
    const popoverBtn = makeButton();
    registry.bind('new', headerBtn);
    registry.bind('new', popoverBtn);

    assert.equal(headerBtn.disabled, true, 'bind() applies the initial disabled state');
    assert.equal(headerBtn.title, 'New');
    assert.equal(popoverBtn.disabled, true);

    headerBtn.click();
    assert.equal(runCount, 0, 'click on a disabled bound control must not run the command');

    enabled = true;
    // Neither control's disabled state auto-updates until refresh() runs —
    // this is the "one refresh syncs every bound control" contract (#445).
    assert.equal(headerBtn.disabled, true);
    registry.refresh();
    assert.equal(headerBtn.disabled, false);
    assert.equal(popoverBtn.disabled, false, 'refresh() syncs every control bound to the command, not just the one that changed');

    headerBtn.click();
    assert.equal(runCount, 1);
    popoverBtn.click();
    assert.equal(runCount, 2);
});

test('bind: tooltip includes the shortcut hint when present', () => {
    const registry = createCommandRegistry();
    registry.register(makeCommand({ id: 'save-as', label: 'Save As…', shortcut: 'Ctrl+S', isEnabled: () => true }));
    const btn = makeButton();
    registry.bind('save-as', btn);
    assert.equal(btn.title, 'Save As… (Ctrl+S)');
});

test('bind: passes the signal through to addEventListener so it can be torn down on destroy', () => {
    const registry = createCommandRegistry();
    registry.register(makeCommand({ id: 'redo' }));
    let capturedOptions: unknown;
    const el = {
        disabled: false,
        title: '',
        addEventListener(_kind: string, _fn: () => void, options: unknown) { capturedOptions = options; },
    } as unknown as HTMLButtonElement;
    const controller = new AbortController();
    registry.bind('redo', el, controller.signal);
    assert.deepEqual(capturedOptions, { signal: controller.signal });
});

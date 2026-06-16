import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setupToggleButton } from '../../src/ui/toggle-button';

/** Mini DOM stub — enough to drive setupToggleButton without jsdom. */
function makeBtn(): {
    el: { dataset: Record<string, string>; title: string; ariaLabel: string; _handlers: (() => void)[]; click: () => void };
    handle: HTMLButtonElement;
} {
    const handlers: (() => void)[] = [];
    const dataset: Record<string, string> = {};
    let title = '';
    let ariaLabel = '';
    const el = {
        dataset, _handlers: handlers,
        get title() { return title; },
        set title(v: string) { title = v; },
        get ariaLabel() { return ariaLabel; },
        setAttribute(name: string, value: string) {
            if (name === 'aria-label') ariaLabel = value;
        },
        addEventListener(_kind: string, fn: () => void) {
            handlers.push(fn);
        },
        click() { for (const h of handlers) h(); },
    };
    return { el, handle: el as unknown as HTMLButtonElement };
}

test('setupToggleButton: applies initial state and label', () => {
    const { el, handle } = makeBtn();
    setupToggleButton(handle, {
        off: { state: 'paused', label: 'Play' },
        on:  { state: 'playing', label: 'Pause' },
    }, 'off', () => { /* noop */ });
    assert.equal(el.dataset.state, 'paused');
    assert.equal(el.title, 'Play');
    assert.equal(el.ariaLabel, 'Play');
});

test('setupToggleButton: click toggles state + fires handler with next state', () => {
    const { el, handle } = makeBtn();
    const calls: ('off' | 'on')[] = [];
    setupToggleButton(handle, {
        off: { state: 'paused', label: 'Play' },
        on:  { state: 'playing', label: 'Pause' },
    }, 'off', (next) => { calls.push(next); });
    el.click();
    assert.equal(el.dataset.state, 'playing');
    assert.equal(el.title, 'Pause');
    assert.equal(el.ariaLabel, 'Pause');
    assert.deepEqual(calls, ['on']);

    el.click();
    assert.equal(el.dataset.state, 'paused');
    assert.deepEqual(calls, ['on', 'off']);
});

test('setupToggleButton: controller.setState syncs without firing handler', () => {
    const { el, handle } = makeBtn();
    const calls: ('off' | 'on')[] = [];
    const ctl = setupToggleButton(handle, {
        off: { state: 'paused', label: 'Play' },
        on:  { state: 'playing', label: 'Pause' },
    }, 'off', (next) => { calls.push(next); });

    ctl.setState('on');
    assert.equal(el.dataset.state, 'playing');
    assert.equal(ctl.current, 'on');
    assert.deepEqual(calls, [], 'setState does not invoke onClick');

    ctl.setState('off');
    assert.equal(ctl.current, 'off');
});

test('setupToggleButton: initial="on" applies on-state immediately', () => {
    const { el, handle } = makeBtn();
    setupToggleButton(handle, {
        off: { state: 'paused', label: 'Play' },
        on:  { state: 'playing', label: 'Pause' },
    }, 'on', () => { /* noop */ });
    assert.equal(el.dataset.state, 'playing');
    assert.equal(el.title, 'Pause');
});

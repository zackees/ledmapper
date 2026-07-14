/**
 * Unit tests for `wireFilePicker` — the shared `<input type="file">`
 * change-event helper.
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import { resetAndOpenFilePicker, wireFilePicker } from '../../src/drag-drop';

interface MockListener { type: string; fn: () => void }

class MockInput {
    public files: { 0?: File } & { readonly length: number };
    public value = '';
    public clickCount = 0;
    public valuesAtClick: string[] = [];
    private listeners: MockListener[] = [];
    constructor(files: File[]) {
        this.files = Object.assign(files as unknown as { length: number }, { length: files.length });
    }
    addEventListener(type: string, fn: () => void, _opts?: AddEventListenerOptions) {
        this.listeners.push({ type, fn });
    }
    dispatch(type: string) {
        for (const l of this.listeners) {
            if (l.type === type) l.fn();
        }
    }
    setFiles(files: File[]) {
        this.files = Object.assign(files as unknown as { length: number }, { length: files.length });
    }
    click() {
        this.clickCount++;
        this.valuesAtClick.push(this.value);
    }
}

function fakeFile(name: string): File {
    return { name, type: '', size: 0 } as unknown as File;
}

describe('wireFilePicker', () => {
    test('forwards the first file when the input fires change', () => {
        const a = fakeFile('a.json');
        const input = new MockInput([a]);
        const seen: (File | undefined)[] = [];
        wireFilePicker({
            input: input as unknown as HTMLInputElement,
            onFile: (f) => { seen.push(f); },
        });
        input.dispatch('change');
        assert.deepEqual(seen, [a]);
    });

    test('forwards undefined when the input has no files', () => {
        const input = new MockInput([]);
        let calls = 0;
        let lastSeen: File | undefined = fakeFile('placeholder');
        wireFilePicker({
            input: input as unknown as HTMLInputElement,
            onFile: (f) => { calls++; lastSeen = f; },
        });
        input.dispatch('change');
        assert.equal(calls, 1);
        assert.equal(lastSeen, undefined);
    });

    test('fires onFile every time the user picks again', () => {
        const a = fakeFile('a.json');
        const b = fakeFile('b.json');
        const input = new MockInput([a]);
        const seen: string[] = [];
        wireFilePicker({
            input: input as unknown as HTMLInputElement,
            onFile: (f) => { if (f) seen.push(f.name); },
        });
        input.dispatch('change');
        input.setFiles([b]);
        input.dispatch('change');
        assert.deepEqual(seen, ['a.json', 'b.json']);
    });

    test('does NOT call onFile at startup (unlike wireSliderReadout)', () => {
        const input = new MockInput([fakeFile('x')]);
        let calls = 0;
        wireFilePicker({
            input: input as unknown as HTMLInputElement,
            onFile: () => { calls++; },
        });
        assert.equal(calls, 0);
    });
});

describe('resetAndOpenFilePicker', () => {
    test('clears a stale selection before opening the picker', () => {
        const input = new MockInput([]);
        input.value = 'C:\\fakepath\\map.json';

        resetAndOpenFilePicker(input as unknown as HTMLInputElement);

        assert.equal(input.value, '');
        assert.equal(input.clickCount, 1);
        assert.deepEqual(input.valuesAtClick, ['']);
    });

    test('can reopen the same input repeatedly', () => {
        const input = new MockInput([]);

        resetAndOpenFilePicker(input as unknown as HTMLInputElement);
        input.value = 'C:\\fakepath\\map.json';
        resetAndOpenFilePicker(input as unknown as HTMLInputElement);

        assert.equal(input.clickCount, 2);
        assert.deepEqual(input.valuesAtClick, ['', '']);
    });
});

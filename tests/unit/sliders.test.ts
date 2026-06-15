/**
 * Unit tests for `wireSliderReadout`.
 *
 * The helper is a thin DOM-event utility, so we build minimal Event
 * dispatchers rather than pulling jsdom into the unit test runner.
 */

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';

import { wireSliderReadout } from '../../src/ui/sliders';

interface MockListener {
    type: string;
    fn: () => void;
}

class MockReadout {
    public textContent = '';
}

class MockSlider {
    public value: string;
    private listeners: MockListener[] = [];
    constructor(initial: string) { this.value = initial; }
    addEventListener(type: string, fn: () => void, _options?: AddEventListenerOptions) {
        this.listeners.push({ type, fn });
    }
    dispatch(type: string) {
        for (const l of this.listeners) {
            if (l.type === type) l.fn();
        }
    }
}

function mock() {
    const slider = new MockSlider('42');
    const readout = new MockReadout();
    return { slider, readout };
}

describe('wireSliderReadout', () => {
    test('writes the initial slider value into the readout at startup', () => {
        const { slider, readout } = mock();
        wireSliderReadout({ slider: slider as unknown as HTMLInputElement, readout: readout as unknown as HTMLElement });
        assert.equal(readout.textContent, '42');
    });

    test('applies the format function to the displayed value', () => {
        const { slider, readout } = mock();
        slider.value = '7';
        wireSliderReadout({
            slider: slider as unknown as HTMLInputElement,
            readout: readout as unknown as HTMLElement,
            format: (v) => `${v}%`,
        });
        assert.equal(readout.textContent, '7%');
    });

    test('updates the readout on every input event', () => {
        const { slider, readout } = mock();
        wireSliderReadout({
            slider: slider as unknown as HTMLInputElement,
            readout: readout as unknown as HTMLElement,
            format: (v) => (parseFloat(v) / 10).toFixed(1),
        });
        assert.equal(readout.textContent, '4.2');
        slider.value = '155';
        slider.dispatch('input');
        assert.equal(readout.textContent, '15.5');
    });

    test('runs onChange once at startup and on every event', () => {
        const { slider } = mock();
        const seen: string[] = [];
        wireSliderReadout({
            slider: slider as unknown as HTMLInputElement,
            onChange: (raw) => { seen.push(raw); },
        });
        assert.deepEqual(seen, ['42']);
        slider.value = '100';
        slider.dispatch('input');
        slider.value = '0';
        slider.dispatch('input');
        assert.deepEqual(seen, ['42', '100', '0']);
    });

    test('returns a getter for the current raw value', () => {
        const { slider } = mock();
        const getValue = wireSliderReadout({ slider: slider as unknown as HTMLInputElement });
        assert.equal(getValue(), '42');
        slider.value = '99';
        assert.equal(getValue(), '99');
    });

    test('omitting readout still runs onChange', () => {
        const { slider } = mock();
        let calls = 0;
        wireSliderReadout({
            slider: slider as unknown as HTMLInputElement,
            onChange: () => { calls++; },
        });
        slider.dispatch('input');
        assert.equal(calls, 2); // once at init, once at dispatch
    });
});

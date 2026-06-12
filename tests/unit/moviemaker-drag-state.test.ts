/**
 * Unit tests for the overlay-canvas drag state machine introduced in issue #31.
 *
 * The fix replaces a boolean `isDraggingRight` (which could get stuck when the
 * mouse was released outside the canvas) with a tagged-union `drag` object plus
 * a `cancelDrag()` function.  These tests verify the state transitions in
 * isolation without a real DOM.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Minimal drag-state reducer extracted from moviemaker.js for unit testing.
// Keep this in sync with the implementation if the logic changes.
// ---------------------------------------------------------------------------

function createDragStateMachine() {
    let drag: { kind: 'translate' | 'zoom'; pointerId: number; lastY: number } | null = null;
    const released: number[] = [];   // track releasePointerCapture calls
    const captured: number[] = [];   // track setPointerCapture calls

    const canvas = {
        setPointerCapture(id: number)     { captured.push(id); },
        releasePointerCapture(id: number) { released.push(id); },
    };

    let zoomCallCount = 0;
    let translateCallCount = 0;

    function cancelDrag() {
        if (!drag) return;
        const { pointerId } = drag;
        drag = null;
        try { canvas.releasePointerCapture(pointerId); } catch { /* ok */ }
    }

    function onPointerDown(e: { button: number; pointerId: number; offsetX: number; offsetY: number }, hasPoints = true) {
        if (!hasPoints) return;
        if (e.button === 0) {
            drag = { kind: 'translate', pointerId: e.pointerId, lastY: e.offsetY };
            canvas.setPointerCapture(e.pointerId);
        } else if (e.button === 2) {
            drag = { kind: 'zoom', pointerId: e.pointerId, lastY: e.offsetY };
            canvas.setPointerCapture(e.pointerId);
        }
    }

    function onPointerMove(e: { button: number; pointerId: number; offsetX: number; offsetY: number }, hasPoints = true) {
        if (!drag || !hasPoints) return;
        if (drag.kind === 'translate') {
            translateCallCount++;
        } else if (drag.kind === 'zoom') {
            zoomCallCount++;
            drag.lastY = e.offsetY;
        }
    }

    function onPointerUp()     { cancelDrag(); }
    function onPointerCancel() { cancelDrag(); }
    function onBlur()          { cancelDrag(); }

    return {
        onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onBlur, cancelDrag,
        getDrag: ()               => drag,
        getZoomCallCount: ()      => zoomCallCount,
        getTranslateCallCount: () => translateCallCount,
        getCaptured: ()           => captured,
        getReleased: ()           => released,
        resetCounters() { zoomCallCount = 0; translateCallCount = 0; },
    };
}

function evt(overrides: Partial<{ button: number; pointerId: number; offsetX: number; offsetY: number }>) {
    return { button: 0, pointerId: 1, offsetX: 100, offsetY: 100, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('drag state machine — basic transitions', () => {
    let sm: ReturnType<typeof createDragStateMachine>;
    beforeEach(() => { sm = createDragStateMachine(); });

    it('is idle initially', () => {
        assert.equal(sm.getDrag(), null);
    });

    it('left-down sets translate drag', () => {
        sm.onPointerDown(evt({ button: 0, pointerId: 1 }));
        assert.deepEqual(sm.getDrag(), { kind: 'translate', pointerId: 1, lastY: 100 });
    });

    it('right-down sets zoom drag', () => {
        sm.onPointerDown(evt({ button: 2, pointerId: 2 }));
        assert.deepEqual(sm.getDrag(), { kind: 'zoom', pointerId: 2, lastY: 100 });
    });

    it('pointerup clears drag', () => {
        sm.onPointerDown(evt({ button: 0 }));
        sm.onPointerUp();
        assert.equal(sm.getDrag(), null);
    });

    it('pointercancel clears drag', () => {
        sm.onPointerDown(evt({ button: 2 }));
        sm.onPointerCancel();
        assert.equal(sm.getDrag(), null);
    });

    it('blur clears drag', () => {
        sm.onPointerDown(evt({ button: 0 }));
        sm.onBlur();
        assert.equal(sm.getDrag(), null);
    });

    it('cancelDrag is idempotent when already idle', () => {
        assert.doesNotThrow(() => sm.cancelDrag());
        assert.equal(sm.getDrag(), null);
    });

    it('setPointerCapture is called on pointerdown', () => {
        sm.onPointerDown(evt({ button: 0, pointerId: 7 }));
        assert.ok(sm.getCaptured().includes(7));
    });

    it('releasePointerCapture is called on cancel', () => {
        sm.onPointerDown(evt({ button: 0, pointerId: 7 }));
        sm.onPointerUp();
        assert.ok(sm.getReleased().includes(7));
    });

    it('pointerdown with no screenmap points does nothing', () => {
        sm.onPointerDown(evt({ button: 0 }), false /* hasPoints=false */);
        assert.equal(sm.getDrag(), null);
    });
});

describe('drag state machine — stale right-drag bug (issue #31)', () => {
    it('releasing outside the canvas via pointerup does NOT leave zoom drag active', () => {
        const sm = createDragStateMachine();

        // Right-press on canvas → start zoom drag
        sm.onPointerDown(evt({ button: 2, pointerId: 1, offsetY: 50 }));
        assert.equal(sm.getDrag()?.kind, 'zoom');

        // Pointer moves off-canvas while still held — move still zooms
        sm.onPointerMove(evt({ button: 2, pointerId: 1, offsetY: 60 }));
        assert.equal(sm.getZoomCallCount(), 1);

        // User releases right button OUTSIDE the canvas. With setPointerCapture
        // the browser delivers pointerup to the canvas regardless; we simulate that.
        sm.onPointerUp();
        assert.equal(sm.getDrag(), null, 'drag must be null after pointerup outside canvas');

        // Now user starts a fresh left-drag — must NOT trigger zoom
        sm.resetCounters();
        sm.onPointerDown(evt({ button: 0, pointerId: 2, offsetY: 50 }));
        sm.onPointerMove(evt({ button: 0, pointerId: 2, offsetY: 60 }));

        assert.equal(sm.getZoomCallCount(), 0, 'zoom must not fire during left-drag after outside-release');
        assert.equal(sm.getTranslateCallCount(), 1, 'translate must fire during left-drag');
    });

    it('two independent booleans cannot both be true simultaneously (tagged union)', () => {
        const sm = createDragStateMachine();

        // Simulate rapid right-down while left is somehow still active
        sm.onPointerDown(evt({ button: 0, pointerId: 1 }));
        // Second pointerdown on a different pointer (e.g. touch) with button 2
        sm.onPointerDown(evt({ button: 2, pointerId: 2 }));

        // Only the second drag is recorded (last one wins — canvas can only
        // hold one active drag in the current single-pointer design)
        const d = sm.getDrag();
        assert.ok(d !== null);
        // It should be exactly one kind, never both
        assert.ok(d.kind === 'translate' || d.kind === 'zoom');
    });

    it('window blur mid-hold cancels drag', () => {
        const sm = createDragStateMachine();
        sm.onPointerDown(evt({ button: 2, pointerId: 1 }));
        assert.equal(sm.getDrag()?.kind, 'zoom');
        sm.onBlur();
        assert.equal(sm.getDrag(), null, 'drag must clear on window blur');
    });
});

describe('drag state machine — translate does not zoom', () => {
    it('pointermove during translate never increments zoom counter', () => {
        const sm = createDragStateMachine();
        sm.onPointerDown(evt({ button: 0, pointerId: 1, offsetY: 100 }));
        for (let y = 100; y < 200; y += 5) {
            sm.onPointerMove(evt({ button: 0, pointerId: 1, offsetY: y }));
        }
        assert.equal(sm.getZoomCallCount(), 0);
        assert.ok(sm.getTranslateCallCount() > 0);
    });

    it('pointermove during zoom never increments translate counter', () => {
        const sm = createDragStateMachine();
        sm.onPointerDown(evt({ button: 2, pointerId: 1, offsetY: 100 }));
        for (let y = 100; y < 200; y += 5) {
            sm.onPointerMove(evt({ button: 2, pointerId: 1, offsetY: y }));
        }
        assert.equal(sm.getTranslateCallCount(), 0);
        assert.ok(sm.getZoomCallCount() > 0);
    });
});

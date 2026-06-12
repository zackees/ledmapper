import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StripStore } from '../../src/shapeeditor/strips-model';
import type { StripInfo } from '../../src/shapeeditor/strips-model';

/**
 * Build a fresh stripInfo-shape object identical to what
 * `parseScreenmapMultiStrip` would produce. Using fresh data per test
 * makes ordering issues caught immediately.
 */
function makeInfo(stripSpecs: Array<{ name: string; points: [number, number][]; diameter?: number; video_offset?: number }>): StripInfo {
    const strips: StripInfo['strips'] = [];
    const allPoints: [number, number][] = [];
    let offset = 0;
    for (const { name, points, diameter, video_offset } of stripSpecs) {
        const pts: [number, number][] = points.map(p => [p[0], p[1]]);
        for (const p of pts) allPoints.push([p[0], p[1]]);
        strips.push({
            name,
            points: pts,
            diameter,
            offset,
            count: pts.length,
            video_offset: typeof video_offset === 'number' ? video_offset : offset,
            pin: 'pin1',
            videoOffsetOverride: false,
        });
        offset += pts.length;
    }
    return { strips, allPoints, totalCount: allPoints.length };
}

function makeStore(specs: Array<{ name: string; points: [number, number][]; diameter?: number; video_offset?: number }>) {
    const s = new StripStore();
    s.load(makeInfo(specs));
    return s;
}

const THREE_STRIPS: Array<{ name: string; points: [number, number][] }> = [
    { name: 'a', points: [[0, 0], [1, 0], [2, 0]] }, // offset 0, count 3
    { name: 'b', points: [[10, 0], [11, 0]] },       // offset 3, count 2
    { name: 'c', points: [[20, 0], [21, 0], [22, 0], [23, 0]] }, // offset 5, count 4
];

describe('StripStore — load / get / accessors', () => {
    it('null store reports zero strips and zero total', () => {
        const s = new StripStore();
        assert.strictEqual(s.getStripCount(), 0);
        assert.strictEqual(s.getTotalCount(), 0);
        assert.deepStrictEqual(s.getStrips(), []);
        assert.strictEqual(s.findStripForIndex(0), -1);
    });

    it('load(null) clears state', () => {
        const s = makeStore(THREE_STRIPS);
        assert.strictEqual(s.getStripCount(), 3);
        s.load(null);
        assert.strictEqual(s.getStripCount(), 0);
        assert.strictEqual(s.get(), null);
    });

    it('load adopts the passed reference (mutations are visible)', () => {
        const info = makeInfo(THREE_STRIPS);
        const s = new StripStore();
        s.load(info);
        assert.strictEqual(s.get(), info);
    });
});

describe('StripStore — findStripForIndex', () => {
    it('maps each flat index to the owning strip', () => {
        const s = makeStore(THREE_STRIPS);
        assert.strictEqual(s.findStripForIndex(0), 0);
        assert.strictEqual(s.findStripForIndex(2), 0);
        assert.strictEqual(s.findStripForIndex(3), 1);
        assert.strictEqual(s.findStripForIndex(4), 1);
        assert.strictEqual(s.findStripForIndex(5), 2);
        assert.strictEqual(s.findStripForIndex(8), 2);
    });

    it('returns -1 for out-of-range indices', () => {
        const s = makeStore(THREE_STRIPS);
        assert.strictEqual(s.findStripForIndex(9), -1);
        assert.strictEqual(s.findStripForIndex(-1), -1);
    });
});

describe('StripStore — onInsert / onDelete bookkeeping', () => {
    it('insert in the middle of strip 1 grows that strip and shifts later offsets', () => {
        const s = makeStore(THREE_STRIPS);
        s.onInsert(4); // inside strip b (offset 3, count 2 → range [3,5))
        const strips = s.getStrips();
        assert.strictEqual(strips[0]!.count, 3);
        assert.strictEqual(strips[1]!.count, 3);
        assert.strictEqual(strips[2]!.count, 4);
        assert.strictEqual(strips[0]!.offset, 0);
        assert.strictEqual(strips[1]!.offset, 3);
        assert.strictEqual(strips[2]!.offset, 6);
        assert.strictEqual(s.getTotalCount(), 10);
    });

    it('insert at a strip boundary attaches to the previous strip', () => {
        const s = makeStore(THREE_STRIPS);
        // Boundary between strip a and strip b is flat index 3.
        s.onInsert(3);
        const strips = s.getStrips();
        assert.strictEqual(strips[0]!.count, 4, 'previous strip should absorb the boundary insert');
        assert.strictEqual(strips[1]!.count, 2);
        assert.strictEqual(strips[1]!.offset, 4);
        assert.strictEqual(strips[2]!.offset, 6);
        assert.strictEqual(s.getTotalCount(), 10);
    });

    it('insert past the end appends to the last strip', () => {
        const s = makeStore(THREE_STRIPS);
        s.onInsert(99);
        const strips = s.getStrips();
        assert.strictEqual(strips[2]!.count, 5);
        assert.strictEqual(s.getTotalCount(), 10);
    });

    it('insert with a point updates points arrays and allPoints', () => {
        const s = makeStore(THREE_STRIPS);
        s.onInsert(4, [99, 99]);
        const info = s.get()!;
        assert.strictEqual(info.strips[1]!.points.length, 3);
        assert.deepStrictEqual(info.strips[1]!.points[1], [99, 99]);
        assert.deepStrictEqual(info.allPoints![4], [99, 99]);
        assert.strictEqual(info.allPoints!.length, 10);
    });

    it('delete shrinks the owning strip and shifts later offsets', () => {
        const s = makeStore(THREE_STRIPS);
        s.onDelete(4); // last point of strip b
        const strips = s.getStrips();
        assert.strictEqual(strips[1]!.count, 1);
        assert.strictEqual(strips[2]!.offset, 4);
        assert.strictEqual(s.getTotalCount(), 8);
        assert.strictEqual(s.get()!.allPoints!.length, 8);
    });

    it('delete is a no-op when no info is loaded', () => {
        const s = new StripStore();
        s.onDelete(0);
        assert.strictEqual(s.getTotalCount(), 0);
    });

    it('insert is a no-op when no strips exist', () => {
        const s = new StripStore();
        s.load({ strips: [], allPoints: [], totalCount: 0 });
        s.onInsert(0, [1, 1]);
        assert.strictEqual(s.getTotalCount(), 0);
    });
});

describe('StripStore — snapshot / restore', () => {
    it('snapshot captures offset/count/totalCount and excludes points', () => {
        const s = makeStore(THREE_STRIPS);
        const snap = s.snapshot()!;
        assert.strictEqual(snap.totalCount, 9);
        assert.strictEqual(snap.strips.length, 3);
        assert.strictEqual(snap.strips[1]!.offset, 3);
        assert.strictEqual(snap.strips[1]!.count, 2);
        assert.strictEqual(snap.strips[0]!.points, undefined);
    });

    it('restore undoes onInsert offsets/counts', () => {
        const s = makeStore(THREE_STRIPS);
        const snap = s.snapshot()!;
        s.onInsert(4);
        assert.strictEqual(s.getTotalCount(), 10);
        s.restore(snap);
        const strips = s.getStrips();
        assert.strictEqual(strips[0]!.offset, 0);
        assert.strictEqual(strips[1]!.offset, 3);
        assert.strictEqual(strips[1]!.count, 2);
        assert.strictEqual(strips[2]!.offset, 5);
        assert.strictEqual(s.getTotalCount(), 9);
    });

    it('restore undoes onDelete offsets/counts', () => {
        const s = makeStore(THREE_STRIPS);
        const snap = s.snapshot()!;
        s.onDelete(4);
        s.restore(snap);
        const strips = s.getStrips();
        assert.strictEqual(strips[1]!.count, 2);
        assert.strictEqual(strips[2]!.offset, 5);
        assert.strictEqual(s.getTotalCount(), 9);
    });

    it('snapshot returns null when no info loaded', () => {
        const s = new StripStore();
        assert.strictEqual(s.snapshot(), null);
    });
});

describe('StripStore — addStrip', () => {
    it('appends a new strip with correct offset/count/totalCount', () => {
        const s = makeStore(THREE_STRIPS);
        const idx = s.addStrip({ name: 'd', points: [[30, 0], [31, 0]] });
        assert.strictEqual(idx, 3);
        const strips = s.getStrips();
        assert.strictEqual(strips[3]!.offset, 9);
        assert.strictEqual(strips[3]!.count, 2);
        assert.strictEqual(s.getTotalCount(), 11);
        assert.strictEqual(s.get()!.allPoints!.length, 11);
        assert.deepStrictEqual(s.get()!.allPoints![9], [30, 0]);
    });

    it('addStrip on an empty store initializes info', () => {
        const s = new StripStore();
        s.addStrip({ name: 'first', points: [[0, 0]] });
        assert.strictEqual(s.getStripCount(), 1);
        assert.strictEqual(s.getTotalCount(), 1);
    });

    it('addStrip auto-names when name omitted', () => {
        const s = makeStore(THREE_STRIPS);
        const idx = s.addStrip({ points: [[0, 0]] });
        assert.strictEqual(s.getStrips()[idx]!.name, 'strip4');
    });
});

describe('StripStore — removeStrip', () => {
    it('removes the middle strip and shifts later offsets down', () => {
        const s = makeStore(THREE_STRIPS);
        s.removeStrip(1);
        const strips = s.getStrips();
        assert.strictEqual(strips.length, 2);
        assert.strictEqual(strips[0]!.name, 'a');
        assert.strictEqual(strips[1]!.name, 'c');
        assert.strictEqual(strips[1]!.offset, 3);
        assert.strictEqual(strips[1]!.count, 4);
        assert.strictEqual(s.getTotalCount(), 7);
        assert.strictEqual(s.get()!.allPoints!.length, 7);
        // First removed point was at flat index 3 ([10,0]). Now index 3 is from strip c.
        assert.deepStrictEqual(s.get()!.allPoints![3], [20, 0]);
    });

    it('out-of-range removeStrip is a no-op', () => {
        const s = makeStore(THREE_STRIPS);
        s.removeStrip(99);
        assert.strictEqual(s.getStripCount(), 3);
        assert.strictEqual(s.getTotalCount(), 9);
    });
});

describe('StripStore — reorderStrip', () => {
    it('moves a strip and recomputes offsets and allPoints', () => {
        const s = makeStore(THREE_STRIPS);
        s.reorderStrip(0, 2); // a → end
        const strips = s.getStrips();
        assert.deepStrictEqual(strips.map(x => x.name), ['b', 'c', 'a']);
        assert.strictEqual(strips[0]!.offset, 0);
        assert.strictEqual(strips[0]!.count, 2);
        assert.strictEqual(strips[1]!.offset, 2);
        assert.strictEqual(strips[1]!.count, 4);
        assert.strictEqual(strips[2]!.offset, 6);
        assert.strictEqual(strips[2]!.count, 3);
        assert.strictEqual(s.getTotalCount(), 9);
        // allPoints[0] now comes from strip b ([10,0])
        assert.deepStrictEqual(s.get()!.allPoints![0], [10, 0]);
        assert.deepStrictEqual(s.get()!.allPoints![6], [0, 0]);
    });

    it('reorder fromIdx == toIdx is a no-op', () => {
        const s = makeStore(THREE_STRIPS);
        s.reorderStrip(1, 1);
        assert.deepStrictEqual(s.getStrips().map(x => x.name), ['a', 'b', 'c']);
    });
});

describe('StripStore — renameStrip', () => {
    it('renames a strip without touching offsets', () => {
        const s = makeStore(THREE_STRIPS);
        s.renameStrip(1, 'renamed');
        const strips = s.getStrips();
        assert.strictEqual(strips[1]!.name, 'renamed');
        assert.strictEqual(strips[1]!.offset, 3);
        assert.strictEqual(strips[1]!.count, 2);
        assert.strictEqual(s.getTotalCount(), 9);
    });
});

describe('StripStore — updateStrip', () => {
    it('changing diameter does not touch offsets', () => {
        const s = makeStore(THREE_STRIPS);
        s.updateStrip(1, { diameter: 0.42 });
        assert.strictEqual(s.getStrips()[1]!.diameter, 0.42);
        assert.strictEqual(s.getStrips()[1]!.offset, 3);
        assert.strictEqual(s.getTotalCount(), 9);
    });

    it('changing points recomputes offsets, totalCount, allPoints', () => {
        const s = makeStore(THREE_STRIPS);
        s.updateStrip(1, { points: [[50, 5]] }); // shrink strip b from 2 → 1
        const strips = s.getStrips();
        assert.strictEqual(strips[1]!.count, 1);
        assert.strictEqual(strips[2]!.offset, 4);
        assert.strictEqual(s.getTotalCount(), 8);
        assert.deepStrictEqual(s.get()!.allPoints![3], [50, 5]);
        assert.deepStrictEqual(s.get()!.allPoints![4], [20, 0]);
    });

    it('updateStrip ignores attempts to set offset/count directly', () => {
        const s = makeStore(THREE_STRIPS);
        s.updateStrip(1, { offset: 999, count: 999 });
        assert.strictEqual(s.getStrips()[1]!.offset, 3);
        assert.strictEqual(s.getStrips()[1]!.count, 2);
    });

    it('updateStrip can set video_offset without touching offsets', () => {
        const s = makeStore(THREE_STRIPS);
        s.updateStrip(1, { video_offset: 42 });
        assert.strictEqual(s.getStrips()[1]!.video_offset, 42);
        assert.strictEqual(s.getStrips()[1]!.offset, 3);
        assert.strictEqual(s.getStrips()[1]!.count, 2);
        assert.strictEqual(s.getTotalCount(), 9);
    });

    it('reversing points via updateStrip swaps first and last entries', () => {
        const s = makeStore(THREE_STRIPS);
        const reversed = s.getStrips()[2]!.points.slice().reverse();
        s.updateStrip(2, { points: reversed });
        const strip = s.getStrips()[2]!;
        assert.strictEqual(strip.count, 4);
        assert.deepStrictEqual(strip.points[0], [23, 0]);
        assert.deepStrictEqual(strip.points[3], [20, 0]);
        // allPoints rebuilt; strip c starts at offset 5
        assert.deepStrictEqual(s.get()!.allPoints![5], [23, 0]);
        assert.deepStrictEqual(s.get()!.allPoints![8], [20, 0]);
    });
});

// ── Pins (issue #24): pin/order/derived video_offset/snapshot ────────

function makePinStore(specs: Array<{ name: string; points: [number, number][]; diameter?: number; video_offset?: number; pin?: string; videoOffsetOverride?: boolean }>) {
    const s = new StripStore();
    const info = makeInfo(specs);
    // Stamp pins/overrides post-makeInfo since makeInfo doesn't know them.
    specs.forEach((spec, i) => {
        if (spec.pin) info.strips[i]!.pin = spec.pin;
        if (spec.videoOffsetOverride) info.strips[i]!.videoOffsetOverride = true;
        if (spec.video_offset !== undefined) info.strips[i]!.video_offset = spec.video_offset;
    });
    s.load(info);
    return s;
}

describe('StripStore — pins', () => {
    it('load normalizes missing pin/override fields', () => {
        const s = makeStore(THREE_STRIPS);
        for (const strip of s.getStrips()) {
            assert.strictEqual(strip.pin, 'pin1');
            assert.strictEqual(strip.videoOffsetOverride, false);
        }
    });

    it('pinOf defaults blank/missing pins to pin1', () => {
        assert.strictEqual(StripStore.pinOf({}), 'pin1');
        assert.strictEqual(StripStore.pinOf({ pin: '  ' }), 'pin1');
        assert.strictEqual(StripStore.pinOf({ pin: 'gpio5' }), 'gpio5');
        assert.strictEqual(StripStore.pinOf(null as unknown as { pin?: string }), 'pin1');
    });

    it('getPinOrder returns first-appearance order', () => {
        const s = makePinStore([
            { name: 'a', points: [[0, 0]], pin: 'pin2' },
            { name: 'b', points: [[1, 0]], pin: 'pin1' },
            { name: 'c', points: [[2, 0]], pin: 'pin2' },
        ]);
        assert.deepStrictEqual(s.getPinOrder(), ['pin2', 'pin1']);
    });

    it('load re-derives video_offset over pin order (within-pin walk)', () => {
        const s = makePinStore([
            { name: 'a', points: [[0, 0], [1, 0], [2, 0]], pin: 'pin1' }, // 3 LEDs
            { name: 'b', points: [[10, 0], [11, 0]], pin: 'pin2' },       // 2 LEDs
            { name: 'c', points: [[20, 0], [21, 0], [22, 0], [23, 0]], pin: 'pin1' }, // 4 LEDs
        ]);
        const vo = s.getStrips().map(x => x.video_offset);
        // Chain walk: pin1 (a=0, c=3) then pin2 (b=7)
        assert.deepStrictEqual(vo, [0, 7, 3]);
    });

    it('overridden strip keeps its manual value but occupies chain space', () => {
        const s = makePinStore([
            { name: 'a', points: [[0, 0], [1, 0], [2, 0]], video_offset: 100, videoOffsetOverride: true },
            { name: 'b', points: [[10, 0], [11, 0]] },
        ]);
        assert.strictEqual(s.getStrips()[0]!.video_offset, 100);
        // b still derived as if a occupies 0..2
        assert.strictEqual(s.getStrips()[1]!.video_offset, 3);
        assert.strictEqual(s.getDerivedVideoOffset(0), 0);
        assert.strictEqual(s.getDerivedVideoOffset(1), 3);
    });

    it('updateStrip({pin}) recomputes derived offsets', () => {
        const s = makeStore(THREE_STRIPS); // a:3, b:2, c:4 all pin1
        s.updateStrip(1, { pin: 'pin2' });
        const vo = s.getStrips().map(x => x.video_offset);
        // pin1: a=0, c=3; pin2: b=7
        assert.deepStrictEqual(vo, [0, 7, 3]);
        assert.deepStrictEqual(s.getPinOrder(), ['pin1', 'pin2']);
    });

    it('addStrip stores pin and override', () => {
        const s = makeStore(THREE_STRIPS);
        const idx = s.addStrip({ name: 'd', points: [[30, 0]], pin: 'pin3', videoOffsetOverride: true, video_offset: 55 });
        const d = s.getStrips()[idx]!;
        assert.strictEqual(d.pin, 'pin3');
        assert.strictEqual(d.videoOffsetOverride, true);
        assert.strictEqual(d.video_offset, 55);
    });

    it('snapshot/restore round-trips pin, override, and video_offset', () => {
        const s = makePinStore([
            { name: 'a', points: [[0, 0], [1, 0]], pin: 'pin1' },
            { name: 'b', points: [[10, 0]], pin: 'pin2', video_offset: 9, videoOffsetOverride: true },
        ]);
        const snap = s.snapshot()!;
        s.updateStrip(1, { pin: 'pin1', videoOffsetOverride: false });
        assert.strictEqual(s.getStrips()[1]!.pin, 'pin1');
        s.restore(snap);
        assert.strictEqual(s.getStrips()[1]!.pin, 'pin2');
        assert.strictEqual(s.getStrips()[1]!.videoOffsetOverride, true);
        assert.strictEqual(s.getStrips()[1]!.video_offset, 9);
    });

    it('removeStrip recomputes derived offsets', () => {
        const s = makePinStore([
            { name: 'a', points: [[0, 0], [1, 0], [2, 0]], pin: 'pin1' },
            { name: 'b', points: [[10, 0], [11, 0]], pin: 'pin2' },
            { name: 'c', points: [[20, 0]], pin: 'pin2' },
        ]);
        s.removeStrip(1); // remove b
        const vo = s.getStrips().map(x => x.video_offset);
        assert.deepStrictEqual(vo, [0, 3]);
    });
});

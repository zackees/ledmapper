import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractGatherSample, createTransformedScreenmap } from '../../src/moviemaker/transforms';

// #250: the "seam" investigation proved the CPU overlay transform and the
// GATHER_FRAG shader implement the same mapping. These tests pin that
// contract from the CPU side: (1) extractGatherSample surfaces the
// out-of-bounds count the shader encodes in alpha, and (2) the CPU
// transform + the shader's pixel-snap/bounds rules classify edge LEDs
// exactly like the shader does (the shader math is mirrored here — if
// either side changes without the other, this file is the tripwire).

describe('extractGatherSample oobCount', () => {
    function buffer(entries: [number, number, number, number][]): Uint8Array {
        const buf = new Uint8Array(entries.length * 4);
        entries.forEach(([r, g, b, a], i) => {
            buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = a;
        });
        return buf;
    }

    it('counts alpha<128 texels as out-of-bounds and zeroes them', () => {
        const gather = buffer([
            [200, 100, 50, 255], // in
            [7, 8, 9, 0],        // out (shader writes vec4(0.0); rgb garbage must be ignored)
            [10, 20, 30, 255],   // in
            [1, 2, 3, 0],        // out
        ]);
        const rgb = new Uint8Array(12);
        const { oobCount, rgbPts } = extractGatherSample(gather, 4, rgb);
        assert.equal(oobCount, 2);
        assert.deepEqual([...rgbPts.subarray(3, 6)], [0, 0, 0]);
        assert.deepEqual([...rgbPts.subarray(9, 12)], [0, 0, 0]);
    });

    it('reports zero when everything is in bounds', () => {
        const gather = buffer([[1, 2, 3, 255], [4, 5, 6, 200]]);
        const { oobCount } = extractGatherSample(gather, 2, new Uint8Array(6));
        assert.equal(oobCount, 0);
    });

    it('excludes out-of-bounds LEDs from avgBri', () => {
        const gather = buffer([[255, 255, 255, 255], [0, 0, 0, 0]]);
        const { avgBri } = extractGatherSample(gather, 2, new Uint8Array(6));
        assert.equal(avgBri, 1); // the single in-bounds LED is full white
    });
});

describe('CPU transform matches the gather shader edge classification', () => {
    /** Mirror of GATHER_FRAG: rotate -> zoom -> translate -> floor(p+0.5)
     *  pixel snap -> half-open bounds check [0, res). */
    function shaderClassify(pt: [number, number], rotateDeg: number, zoom: number, tx: number, ty: number, w: number, h: number) {
        const r = rotateDeg * Math.PI / 180;
        const c = Math.cos(r), s = Math.sin(r);
        const x = (pt[0] * c - pt[1] * s) * zoom + tx;
        const y = (pt[0] * s + pt[1] * c) * zoom + ty;
        const px = Math.floor(x + 0.5), py = Math.floor(y + 0.5);
        return { px, py, inBounds: px >= 0 && px < w && py >= 0 && py < h };
    }

    // The #250 repro geometry: square map fit to ±115 in a 270x480 video,
    // translate = video center.
    const W = 270, H = 480, TX = 135, TY = 240;

    it('zoom 1.0 keeps the extreme columns in bounds', () => {
        for (const x of [-115, 115]) {
            const cpu = createTransformedScreenmap([[x, 0]], 0, 1.0, [TX, TY])[0];
            const sh = shaderClassify([x, 0], 0, 1.0, TX, TY, W, H);
            assert.equal(Math.floor(cpu[0] + 0.5), sh.px);
            assert.equal(sh.inBounds, true);
        }
    });

    it('zoom 1.3 pushes the extreme columns out of bounds, next-in columns stay in', () => {
        // Outermost 16x16-grid columns sit at ±115; their zoomed positions
        // (135 ± 149.5) fall outside [0, 270).
        for (const x of [-115, 115]) {
            assert.equal(shaderClassify([x, 0], 0, 1.3, TX, TY, W, H).inBounds, false);
        }
        // The adjacent columns (±115 ∓ one 15.33px pitch) stay inside.
        const pitch = 230 / 15;
        for (const x of [-115 + pitch, 115 - pitch]) {
            assert.equal(shaderClassify([x, 0], 0, 1.3, TX, TY, W, H).inBounds, true);
        }
    });

    it('CPU and shader agree across a rotation sweep at the edges', () => {
        for (const rot of [0, 15, 45, 90, 180, 270]) {
            for (const pt of [[-115, -115], [115, -115], [115, 115], [-115, 115]] as [number, number][]) {
                const cpu = createTransformedScreenmap([pt], rot, 1.3, [TX, TY])[0];
                const sh = shaderClassify(pt, rot, 1.3, TX, TY, W, H);
                assert.equal(Math.floor(cpu[0] + 0.5), sh.px, `x mismatch rot=${rot} pt=${pt.join(',')}`);
                assert.equal(Math.floor(cpu[1] + 0.5), sh.py, `y mismatch rot=${rot} pt=${pt.join(',')}`);
            }
        }
    });
});

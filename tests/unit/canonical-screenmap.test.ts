import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
    analyzeCanonical64x64Divergence,
    CANONICAL_64X64_PRESET,
    getDefaultPresetFile,
    isCanonical64x64Geometry,
} from '../../src/canonical-screenmap';

const canonicalText = readFileSync(
    new URL('../../public/screenmaps/64x64_quad_serpentine.json', import.meta.url),
    'utf8',
);

function corruptedReproduction(): string {
    const doc = JSON.parse(canonicalText) as {
        segments: { group: string; x: number[]; y: number[] }[];
    };
    const translate = (index: number, dx: number, dy: number) => {
        const segment = doc.segments[index];
        assert.ok(segment);
        segment.x = segment.x.map((x) => x + dx);
        segment.y = segment.y.map((y) => y + dy);
    };
    translate(5, 0.4971, 0.5062);
    translate(7, 0.4906, 0);
    translate(13, 0.4893, -0.248);
    translate(15, 0.4906, 0);
    doc.segments[7]?.x.splice(86, 0, 57.6806);
    doc.segments[7]?.y.splice(86, 0, 21);
    doc.segments[13]?.x.splice(88, 0, 56.3167);
    doc.segments[13]?.y.splice(88, 0, 36.752);
    return JSON.stringify(doc);
}

describe('canonical 64x64 screenmap', () => {
    it('is the manifest-declared default instead of relying on manifest order', () => {
        const manifest = JSON.parse(readFileSync(
            new URL('../../public/screenmaps/manifest.json', import.meta.url),
            'utf8',
        )) as unknown;
        assert.equal(getDefaultPresetFile(manifest), CANONICAL_64X64_PRESET);
    });

    it('does not flag the canonical preset or an unrelated custom layout', () => {
        assert.equal(isCanonical64x64Geometry(canonicalText, canonicalText), true);
        assert.equal(analyzeCanonical64x64Divergence(canonicalText, canonicalText), null);
        const custom = JSON.stringify({ map: { strip1: { x: [0, 1, 2, 3], y: [0, 0, 0, 0] } } });
        assert.equal(isCanonical64x64Geometry(custom, canonicalText), false);
        assert.equal(analyzeCanonical64x64Divergence(custom, canonicalText), null);
    });

    it('recognizes the supplied 4098-point reproduction and identifies its damage', () => {
        const result = analyzeCanonical64x64Divergence(corruptedReproduction(), canonicalText);
        assert.ok(result);
        assert.equal(result.actualLedCount, 4098);
        assert.equal(result.expectedLedCount, 4096);
        assert.deepEqual(result.shiftedStrips, ['q1_p1', 'q1_p3', 'q3_p1', 'q3_p3']);
        assert.deepEqual(result.extraPoints, [
            { strip: 'q1_p3', index: 86, point: [57.6806, 21] },
            { strip: 'q3_p1', index: 88, point: [56.3167, 36.752] },
        ]);
    });
});

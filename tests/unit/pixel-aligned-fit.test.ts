import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { centerAndFitPoints, computeCenterFitScale, parseScreenmapMultiStrip } from '../../src/common';
import { transformToCenter } from '../../src/moviemaker/transforms';

function serpentineGrid(size: number): [number, number][] {
    const points: [number, number][] = [];
    for (let y = 0; y < size; y++) {
        for (let column = 0; column < size; column++) {
            points.push([y % 2 === 0 ? column : size - 1 - column, y]);
        }
    }
    return points;
}

function presetPoints(file: string): [number, number][] {
    const url = new URL(`../../public/screenmaps/${file}`, import.meta.url);
    return parseScreenmapMultiStrip(readFileSync(url, 'utf8')).allPoints;
}

function roundedAxisLevels(points: [number, number][], axis: 0 | 1): number[] {
    return [...new Set(points.map((point) => Math.round(point[axis])))].sort((a, b) => a - b);
}

function assertUniformRoundedPitch(levels: number[], expectedCount: number): void {
    assert.equal(levels.length, expectedCount);
    const gaps = levels.slice(1).map((value, index) => value - (levels[index] ?? value));
    assert.equal(new Set(gaps).size, 1, `non-uniform raster gaps: ${gaps.join(',')}`);
}

describe('pixel-aligned center-and-fit', () => {
    it('keeps the generic centerAndFitPoints default continuous', () => {
        const points = centerAndFitPoints([[0, 0], [3, 0]], 10, 10, {
            margin: 1,
            center: 'origin',
        });
        assert.deepEqual(points, [[-5, 0], [5, 0]]);
    });

    it('keeps irregular layouts continuous even when pixel alignment is requested', () => {
        const irregular: [number, number][] = [[0, 0], [3, 0], [4, 2]];
        const scale = computeCenterFitScale(irregular, 10, 10, {
            margin: 1,
            center: 'origin',
            pixelAlignScale: true,
        });
        assert.equal(scale, 2.5);
    });

    it('keeps fractional-pitch grids continuous instead of creating half-pixel gaps', () => {
        const grid = serpentineGrid(4).map(([x, y]) => [x / 2, y / 2] as [number, number]);
        const scale = computeCenterFitScale(grid, 5, 5, {
            margin: 1,
            center: 'origin',
            pixelAlignScale: true,
        });
        assert.equal(scale, 10 / 3);
    });

    it('uses one quantized scale for computation and projection', () => {
        const grid = serpentineGrid(16);
        const options = { margin: 20, center: 'origin', pixelAlignScale: true } as const;
        const scale = computeCenterFitScale(grid, 480, 480, options);
        const fitted = centerAndFitPoints(grid, 480, 480, options);

        assert.equal(scale, 29);
        assert.equal(fitted[1]?.[0] - fitted[0]?.[0], scale);
    });

    it('audits all 16 rows and columns in the Record default preset', () => {
        const fitted = transformToCenter(presetPoints('16x16_grid.json'), 480, 480);
        assertUniformRoundedPitch(roundedAxisLevels(fitted, 0), 16);
        assertUniformRoundedPitch(roundedAxisLevels(fitted, 1), 16);
    });

    it('keeps both 64x64 control layouts uniformly spaced and centered', () => {
        for (const file of ['64x64_serpentine.json', '64x64_quad_serpentine.json']) {
            const fitted = transformToCenter(presetPoints(file), 480, 480);
            const xs = roundedAxisLevels(fitted, 0);
            const ys = roundedAxisLevels(fitted, 1);
            assertUniformRoundedPitch(xs, 64);
            assertUniformRoundedPitch(ys, 64);
            const centerX = fitted.reduce((sum, point) => sum + point[0], 0) / fitted.length;
            const centerY = fitted.reduce((sum, point) => sum + point[1], 0) / fitted.length;
            assert.ok(Math.abs(centerX) < 1e-9, `${file} x center ${String(centerX)}`);
            assert.ok(Math.abs(centerY) < 1e-9, `${file} y center ${String(centerY)}`);
        }
    });
});

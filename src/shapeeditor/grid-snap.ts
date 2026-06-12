/**
 * Snap a point to the nearest grid intersection.
 * @param {[number,number]} pt
 * @param {number} gridSize
 * @returns {[number,number]}
 */
export function snapToGrid(pt: any, gridSize: any) {
    if (!gridSize || gridSize <= 0) return [pt[0], pt[1]];
    return [
        Math.round(pt[0] / gridSize) * gridSize,
        Math.round(pt[1] / gridSize) * gridSize,
    ];
}

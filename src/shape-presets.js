/**
 * @param {number} cols
 * @param {number} rows
 * @param {number} [spacing=1]
 * @returns {Array<[number,number]>}
 */
export function generateGrid(cols, rows, spacing = 1) {
    const pts = [];
    for (let row = 0; row < rows; row++) {
        const forward = row % 2 === 0;
        for (let c = 0; c < cols; c++) {
            const col = forward ? c : cols - 1 - c;
            pts.push([col * spacing, row * spacing]);
        }
    }
    return pts;
}

/**
 * @param {number} count
 * @param {number} [spacing=1]
 * @returns {Array<[number,number]>}
 */
export function generateStrip(count, spacing = 1) {
    const pts = [];
    for (let i = 0; i < count; i++) {
        pts.push([i * spacing, 0]);
    }
    return pts;
}

/**
 * @param {number} count
 * @param {number} [radius=5]
 * @returns {Array<[number,number]>}
 */
export function generateRing(count, radius = 5) {
    const pts = [];
    for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI * i) / count;
        pts.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    return pts;
}

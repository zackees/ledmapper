/**
 * Staggered-column LED fill generators (hexagonal dense-circle packing),
 * modeled after Total Control Lighting (TCL) strands hand-laid as vertical
 * columns: in-strand pitch S within a column, columns spaced S*sqrt(3)/2
 * apart, alternate columns offset by S/2, wired as a vertical serpentine.
 *
 * Pure math — no DOM. Used by the shapeeditor panel catalog and the
 * piano_grand.json regeneration script.
 */

const EPS = 1e-9;

/**
 * Fill an arbitrary region with staggered vertical columns of points.
 *
 * Columns are placed at lateral pitch `spacingCm * lateralRatio` across
 * [0, widthCm]. Each column fills the [yMin, yMax] returned by
 * `heightAt(x)` with points at `spacingCm` pitch. Points snap to a global
 * y-lattice (odd columns phase-shifted by spacingCm/2) so adjacent columns
 * interlock as true hexagonal packing regardless of where each column's
 * region starts. Ordering is a vertical serpentine: alternate columns
 * reversed, matching how strands snake through a board.
 *
 * @param {object} p
 * @param {number} p.widthCm total lateral extent of the fill region
 * @param {number} p.spacingCm in-strand (vertical) point pitch
 * @param {number} [p.lateralRatio] column pitch as a fraction of spacingCm
 * @param {boolean} [p.stagger] offset odd columns by spacingCm/2
 * @param {(x:number) => ({yMin:number, yMax:number} | null)} p.heightAt
 *        vertical extent of the region at lateral position x, or null
 *        when x is outside the region
 * @returns {{x: number[], y: number[]}}
 */
export function generateStaggeredColumns({
    widthCm,
    spacingCm,
    lateralRatio = Math.sqrt(3) / 2,
    stagger = true,
    heightAt,
}) {
    const pitch = spacingCm * lateralRatio;
    const x = [];
    const y = [];
    const nCols = Math.floor(widthCm / pitch + EPS) + 1;
    for (let c = 0; c < nCols; c++) {
        const cx = c * pitch;
        const region = heightAt(cx);
        if (!region) continue;
        const phase = (stagger && c % 2 === 1) ? spacingCm / 2 : 0;
        const start = Math.ceil((region.yMin - phase) / spacingCm - EPS) * spacingCm + phase;
        const n = Math.floor((region.yMax - start) / spacingCm + EPS) + 1;
        if (n <= 0) continue;
        const colYs = new Array(n);
        for (let k = 0; k < n; k++) colYs[k] = start + k * spacingCm;
        if (c % 2 === 1) colYs.reverse();
        for (const cy of colYs) {
            x.push(cx);
            y.push(cy);
        }
    }
    return { x, y };
}

/**
 * Rectangular staggered grid: `cols` columns of `rows` points each
 * (count is always cols*rows), serpentine-ordered. Same math as
 * generateStaggeredColumns with a rectangular heightAt.
 *
 * @param {object} p
 * @param {number} p.cols
 * @param {number} p.rows
 * @param {number} [p.spacingCm]
 * @param {number} [p.lateralRatio]
 * @param {boolean} [p.stagger]
 * @returns {Array<[number, number]>} points in panel-local coords
 */
export function generateStaggeredGrid({
    cols,
    rows,
    spacingCm = 2.54,
    lateralRatio = Math.sqrt(3) / 2,
    stagger = true,
}) {
    if (!(cols >= 1) || !(rows >= 1)) return [];
    // yMax extends by S/2 when staggered so odd (offset) columns still fit
    // a full `rows` points.
    const yMax = (rows - 1) * spacingCm + (stagger ? spacingCm / 2 : 0);
    const { x, y } = generateStaggeredColumns({
        widthCm: (cols - 1) * spacingCm * lateralRatio,
        spacingCm,
        lateralRatio,
        stagger,
        heightAt: () => ({ yMin: 0, yMax }),
    });
    const pts = [];
    for (let i = 0; i < x.length; i++) pts.push([x[i], y[i]]);
    return pts;
}

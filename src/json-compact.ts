/**
 * Compact-aware JSON pretty-printer.
 *
 * Standard `JSON.stringify(obj, null, 2)` puts every numeric array element on
 * its own line, which makes a screenmap file with hundreds of LEDs unreadable
 * in the Inspect-JSON modal. This formatter keeps arrays of primitives — and
 * short arrays of `[number, number]` point pairs — on a single line, while
 * pretty-printing objects and heterogeneous arrays normally.
 *
 * Rules:
 *   - Arrays of pure numbers / booleans / nulls → inline `[1, 2, 3]`.
 *   - Arrays of `[number, number]` tuples → inline if the rendered string
 *     fits in `pointPairsInlineMaxLen` (default 100 chars); otherwise
 *     each tuple on its own line, indented.
 *   - Objects → one key per indented line.
 *   - Strings → JSON-escaped.
 */

export interface CompactJsonOptions {
    /** Indent width in spaces. Default 2. */
    indent?: number;
    /** Max characters before a numeric-pair array breaks onto multiple lines. */
    pointPairsInlineMaxLen?: number;
}

export function formatCompactJson(value: unknown, opts: CompactJsonOptions = {}): string {
    const indent = opts.indent ?? 2;
    const pairLen = opts.pointPairsInlineMaxLen ?? 100;
    return render(value, 0, indent, pairLen);
}

function render(value: unknown, depth: number, indent: number, pairLen: number): string {
    const pad = ' '.repeat(depth * indent);
    const padNext = ' '.repeat((depth + 1) * indent);

    if (value === null || value === undefined) return 'null';

    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
    if (typeof value === 'boolean') return String(value);

    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';

        // Inline: primitives only.
        if (value.every(isPrimitive)) {
            return '[' + value.map((v) => render(v, 0, indent, pairLen)).join(', ') + ']';
        }

        // Inline-when-short: arrays of [num, num] pairs.
        if (value.every(isNumberPair)) {
            const tuples = (value as number[][]).map((pair) =>
                '[' + pair.map((n) => String(n)).join(', ') + ']');
            const oneLine = '[' + tuples.join(', ') + ']';
            if (oneLine.length <= pairLen) return oneLine;
            return '[\n' + tuples.map((t) => padNext + t).join(',\n') + '\n' + pad + ']';
        }

        // Default: one item per line.
        const items = value.map((v) => padNext + render(v, depth + 1, indent, pairLen));
        return '[\n' + items.join(',\n') + '\n' + pad + ']';
    }

    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) return '{}';
        const items = entries.map(([k, v]) =>
            padNext + JSON.stringify(k) + ': ' + render(v, depth + 1, indent, pairLen),
        );
        return '{\n' + items.join(',\n') + '\n' + pad + '}';
    }

    // Fallback: shouldn't happen for valid JSON values.
    return JSON.stringify(value);
}

function isPrimitive(v: unknown): boolean {
    return v === null
        || typeof v === 'number'
        || typeof v === 'string'
        || typeof v === 'boolean';
}

function isNumberPair(v: unknown): v is [number, number] {
    return Array.isArray(v)
        && v.length === 2
        && typeof v[0] === 'number'
        && typeof v[1] === 'number';
}

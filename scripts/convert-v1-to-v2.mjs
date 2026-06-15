#!/usr/bin/env node
/**
 * Convert every v1 screenmap under public/screenmaps/ to the v2 schema.
 *
 * v1 shape: { map: { <name>: { x:[], y:[], diameter?:number } } }
 * v2 shape: {
 *   version: 2,
 *   groups:   { <name>: { color } },
 *   segments: [ { id, pin, group, x:[], y:[], diameter? } ]
 * }
 *
 * One v1 map entry → one v2 segment + one v2 group keyed by the same name.
 * - pin defaults to "pin1" (single-pin assumption for v1 multi-strip files).
 * - diameter (when present in v1) is preserved on the segment.
 * - color is auto-assigned from an HSL ramp so the editor shows distinct
 *   strips out of the box.
 *
 * Idempotent: files already in v2 form (version === 2 or `segments` array)
 * are left alone. Skips `manifest.json` and the `v2/` subdirectory.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENMAPS_DIR = join(__dirname, '..', 'public', 'screenmaps');
const SKIP = new Set(['manifest.json']);

/** Build an HSL color string given an index into a finite set. */
function autoColor(i, total) {
  if (total <= 1) return '#3b82f6'; // tailwind blue-500
  const hue = (i * 360) / total;
  // Tailwind-ish saturated, mid-bright. Output as hex via the small
  // helper below so the v2 file looks like every other v2 fixture.
  return hslToHex(hue, 0.7, 0.55);
}

function hslToHex(h, s, l) {
  const C = (1 - Math.abs(2 * l - 1)) * s;
  const Hp = h / 60;
  const X = C * (1 - Math.abs((Hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if      (0 <= Hp && Hp < 1) [r1, g1, b1] = [C, X, 0];
  else if (1 <= Hp && Hp < 2) [r1, g1, b1] = [X, C, 0];
  else if (2 <= Hp && Hp < 3) [r1, g1, b1] = [0, C, X];
  else if (3 <= Hp && Hp < 4) [r1, g1, b1] = [0, X, C];
  else if (4 <= Hp && Hp < 5) [r1, g1, b1] = [X, 0, C];
  else                         [r1, g1, b1] = [C, 0, X];
  const m = l - C / 2;
  const to255 = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to255(r1)}${to255(g1)}${to255(b1)}`;
}

/** Convert a v1 doc → v2 doc. Returns the v2 object or null if input was
 *  already v2 / unrecognized. */
function convert(doc) {
  if (doc.version === 2 || Array.isArray(doc.segments)) return null;
  if (!doc.map || typeof doc.map !== 'object') return null;

  const keys = Object.keys(doc.map);
  const total = keys.length;
  const groups = {};
  const segments = [];
  keys.forEach((name, i) => {
    const strip = doc.map[name];
    if (!strip || !Array.isArray(strip.x) || !Array.isArray(strip.y)) return;
    const color = autoColor(i, total);
    groups[name] = { color };
    const seg = {
      id: name,
      pin: typeof strip.pin === 'string' && strip.pin.trim() !== '' ? strip.pin : 'pin1',
      group: name,
      x: strip.x.slice(),
      y: strip.y.slice(),
    };
    if (typeof strip.diameter === 'number' && Number.isFinite(strip.diameter)) {
      seg.diameter = strip.diameter;
    }
    segments.push(seg);
  });

  return { version: 2, groups, segments };
}

/**
 * Pretty-print v2 with numeric arrays inline (same convention used by
 * the Inspect-JSON modal). Keeps the file readable even when each
 * segment has 4096 LEDs.
 */
function formatCompact(value, depth = 0, indent = 2) {
  const pad = ' '.repeat(depth * indent);
  const padNext = ' '.repeat((depth + 1) * indent);
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((v) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || v === null)) {
      return '[' + value.map((v) => formatCompact(v, 0, indent)).join(', ') + ']';
    }
    const items = value.map((v) => padNext + formatCompact(v, depth + 1, indent));
    return '[\n' + items.join(',\n') + '\n' + pad + ']';
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const items = entries.map(([k, v]) => padNext + JSON.stringify(k) + ': ' + formatCompact(v, depth + 1, indent));
    return '{\n' + items.join(',\n') + '\n' + pad + '}';
  }
  return JSON.stringify(value);
}

function main() {
  const entries = readdirSync(SCREENMAPS_DIR, { withFileTypes: true });
  let converted = 0;
  let skipped = 0;
  for (const e of entries) {
    if (e.isDirectory()) continue;
    if (!e.name.endsWith('.json')) continue;
    if (SKIP.has(e.name)) continue;
    const path = join(SCREENMAPS_DIR, e.name);
    const raw = readFileSync(path, 'utf-8');
    let doc;
    try { doc = JSON.parse(raw); }
    catch (err) { console.warn(`skip ${e.name}: parse error: ${err.message}`); skipped++; continue; }
    const v2 = convert(doc);
    if (!v2) { console.log(`skip ${e.name}: already v2 or unrecognized`); skipped++; continue; }
    writeFileSync(path, formatCompact(v2) + '\n', 'utf-8');
    converted++;
    console.log(`converted ${e.name}: ${v2.segments.length} segment(s)`);
  }
  console.log(`\n${converted} converted, ${skipped} skipped.`);
}

main();

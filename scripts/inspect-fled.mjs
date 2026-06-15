#!/usr/bin/env node
// Diagnostic for .fled video container files. Dumps everything the Movie
// Player parser sees, so a file that "doesn't play" can be triaged in one
// round trip. Usage:
//
//   node scripts/inspect-fled.mjs path/to/video.fled
//
// Reports: magic, version, pixel_format, json_length, embedded JSON
// (parsed if possible), payload size, derived frame count, and whichever
// rejection branch in src/render/rgb-video.ts would have fired.

import fs from 'node:fs';

const FLED_MAGIC = Buffer.from('FLED', 'ascii');
const FLED_VERSION = 1;
const PIXEL_FORMAT_NAMES = {
    0x00: 'rgb8 (3 B/LED)',
    0x01: 'gray8 (1 B/LED)',
    0x02: 'rgba8 (4 B/LED)',
    0x03: 'rgbw8 (4 B/LED)',
    0x04: 'rgb565le (2 B/LED)',
};
const BYTES_PER_LED = { 0x00: 3, 0x01: 1, 0x02: 4, 0x03: 4, 0x04: 2 };

function hex(bytes, n = 32) {
    return [...bytes.subarray(0, n)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function bail(msg) { console.error(msg); process.exit(1); }

const filePath = process.argv[2];
if (!filePath) bail('usage: node scripts/inspect-fled.mjs <path-to-.fled>');

let data;
try { data = fs.readFileSync(filePath); }
catch (err) { bail(`could not read ${filePath}: ${err.message}`); }

console.log(`file: ${filePath}`);
console.log(`size: ${data.length} bytes`);
console.log(`head: ${hex(data, 32)}`);
console.log();

if (data.length < 12) {
    console.log('VERDICT: too small to be a FLED container.');
    console.log('  Movie Player would reject this with: "This video has no embedded screenmap..."');
    process.exit(2);
}

const magic = data.subarray(0, 4);
if (!magic.equals(FLED_MAGIC)) {
    console.log(`VERDICT: NOT a FLED file (saw "${magic.toString('latin1')}" / ${hex(magic, 4)}).`);
    console.log('  Movie Player would reject this with: "This video has no embedded screenmap..."');
    console.log('  Likely causes:');
    console.log('    - This is a legacy headerless .rgb file renamed to .fled');
    console.log('    - This is some other binary that happens to have the .fled extension');
    console.log('    - The file was produced by a tool that does not implement the FLED spec yet');
    console.log('  Fix: re-record from the Mapped Video Maker (/moviemaker/) and use that file.');
    process.exit(3);
}

const version = data[4];
const pixelFormat = data[5];
const reserved6 = data[6];
const reserved7 = data[7];
const jsonLength = data.readUInt32LE(8);
const headerBytes = 12;
const payloadOffset = headerBytes + jsonLength;

console.log(`magic:        OK (FLED)`);
console.log(`version:      ${version}${version === FLED_VERSION ? ' (OK)' : ' (UNSUPPORTED — v1 reader only)'}`);
const fmtName = PIXEL_FORMAT_NAMES[pixelFormat] ?? '(unknown)';
console.log(`pixel_format: 0x${pixelFormat.toString(16).padStart(2, '0')} ${fmtName}`);
console.log(`reserved:     ${reserved6}, ${reserved7}${(reserved6 | reserved7) !== 0 ? ' (WARNING — should be 0)' : ' (OK)'}`);
console.log(`json_length:  ${jsonLength} bytes`);
console.log(`payload @     offset ${payloadOffset}`);
console.log();

let exitCode = 0;
if (version !== FLED_VERSION) {
    console.log(`VERDICT: unsupported-version (${version}). Movie Player rejects: "Unsupported video file (unsupported-version)".`);
    exitCode = 4;
}
const bpl = BYTES_PER_LED[pixelFormat];
if (bpl === undefined) {
    console.log(`VERDICT: unknown-format 0x${pixelFormat.toString(16)}. Movie Player rejects: "Unsupported video file (unknown-format)".`);
    process.exit(5);
}
if (payloadOffset > data.length) {
    console.log(`VERDICT: truncated-json — header claims JSON ends at ${payloadOffset} but file is only ${data.length} bytes.`);
    console.log('  Movie Player rejects: "Unsupported video file (truncated-json)".');
    process.exit(6);
}

const jsonBytes = data.subarray(headerBytes, payloadOffset);
let jsonText;
try { jsonText = new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes); }
catch { console.log('VERDICT: bad-utf8. Movie Player rejects: "Unsupported video file (bad-utf8)".'); process.exit(7); }

console.log('--- embedded JSON ---');
console.log(jsonText);
console.log('--- end JSON ---');
console.log();

let parsed;
try { parsed = JSON.parse(jsonText); }
catch (err) {
    console.log(`VERDICT: JSON region is not valid JSON: ${err.message}`);
    console.log('  Movie Player rejects: "Embedded screenmap in this video is invalid or empty."');
    process.exit(8);
}

// Accept both v1 (`{ map: { name: {x,y} } }`) and v2
// (`{ version: 2, groups, segments: [{ id, x, y, ... }] }`) screenmap shapes.
const isV2 = parsed?.version === 2 || Array.isArray(parsed?.segments);
const isV1 = !isV2 && parsed?.map && typeof parsed.map === 'object';
if (!isV2 && !isV1) {
    console.log('VERDICT: JSON has neither v1 "map" object nor v2 "segments" array. Movie Player rejects: "Embedded screenmap in this video is invalid or empty."');
    exitCode = 9;
}

let ledCount = 0;
const stripEntries = isV2
    ? (parsed?.segments ?? []).map((s) => [s?.id ?? '<missing-id>', s])
    : Object.entries(parsed?.map ?? {});
for (const [name, strip] of stripEntries) {
    const xs = Array.isArray(strip?.x) ? strip.x.length : 0;
    const ys = Array.isArray(strip?.y) ? strip.y.length : 0;
    if (xs !== ys) {
        console.log(`  WARNING: strip "${name}" has ${xs} x-coords but ${ys} y-coords (must match).`);
    }
    ledCount += xs;
}
console.log(`screenmap shape: ${isV2 ? 'v2' : 'v1'} (${stripEntries.length} ${isV2 ? 'segment(s)' : 'strip(s)'})`);
console.log(`derived LED count: ${ledCount}`);
const frameSize = ledCount * bpl;
console.log(`expected frame size: ${ledCount} LEDs x ${bpl} bytes/LED = ${frameSize} bytes`);
console.log();

const payload = data.subarray(payloadOffset);
console.log(`payload bytes: ${payload.length}`);
if (ledCount > 0) {
    if (payload.length % frameSize === 0) {
        console.log(`frame count:   ${payload.length / frameSize} frames (clean multiple)`);
    } else {
        console.log(`frame count:   ${Math.floor(payload.length / frameSize)} full frames + ${payload.length % frameSize} stray bytes`);
        console.log('  Movie Player rejects: "Video payload does not match the embedded screenmap..."');
        exitCode = 10;
    }
} else {
    console.log('  WARNING: ledCount is 0; can\'t compute frame count.');
}

if (exitCode === 0) {
    console.log();
    console.log('VERDICT: file looks well-formed; Movie Player should accept it.');
}
process.exit(exitCode);

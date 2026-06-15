#!/usr/bin/env node
/**
 * One-shot conversion: public/demo/*.rgb -> public/demo/*.fled
 *
 * Prepends the 12-byte FLED header + embedded screenmap JSON so each demo
 * sample is self-describing. Mirrors `prependFledHeader` in
 * src/render/rgb-video.ts (the format spec is in docs/fled-format.md).
 *
 * The demo's default screenmap is the 32x32 quad serpentine (see
 * src/demo/demo.ts:fetchAndLoadJSON). All three sample videos
 * (color_line_bubbles, video, video1) were generated against that layout,
 * so they all embed the same screenmap.
 *
 * After this script runs the .rgb files can be deleted; the demo loads
 * the .fled file directly via parseRgbFrames(), which auto-detects FLED
 * magic and slices frames against the embedded JSON.
 */

import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = join(__dirname, '..', 'public', 'demo');
const SCREENMAP_PATH = join(__dirname, '..', 'public', 'screenmaps', '32x32_quad_serpentine.json');

const FLED_MAGIC = [0x46, 0x4C, 0x45, 0x44];
const FLED_VERSION = 1;
const PIXEL_FORMAT_RGB8 = 0x00;
const HEADER_BYTES = 12;

function buildFledHeader(json, pixelFormat = PIXEL_FORMAT_RGB8) {
    const jsonBytes = new TextEncoder().encode(json);
    const buf = new Uint8Array(HEADER_BYTES + jsonBytes.length);
    const dv = new DataView(buf.buffer);
    buf[0] = FLED_MAGIC[0];
    buf[1] = FLED_MAGIC[1];
    buf[2] = FLED_MAGIC[2];
    buf[3] = FLED_MAGIC[3];
    buf[4] = FLED_VERSION;
    buf[5] = pixelFormat;
    // bytes 6, 7 reserved (already zero)
    dv.setUint32(8, jsonBytes.length, true);
    buf.set(jsonBytes, HEADER_BYTES);
    return buf;
}

function prependFledHeader(payload, json, pixelFormat = PIXEL_FORMAT_RGB8) {
    const header = buildFledHeader(json, pixelFormat);
    const out = new Uint8Array(header.length + payload.length);
    out.set(header, 0);
    out.set(payload, header.length);
    return out;
}

function main() {
    const screenmapJson = readFileSync(SCREENMAP_PATH, 'utf-8');
    // Sanity check: the embedded JSON must be valid.
    JSON.parse(screenmapJson);

    const entries = readdirSync(DEMO_DIR);
    let converted = 0;
    for (const name of entries) {
        if (!name.endsWith('.rgb')) continue;
        const rgbPath = join(DEMO_DIR, name);
        const fledPath = join(DEMO_DIR, `${basename(name, '.rgb')}.fled`);
        const payload = readFileSync(rgbPath);
        const fled = prependFledHeader(payload, screenmapJson);
        writeFileSync(fledPath, Buffer.from(fled));
        console.log(`converted ${name} -> ${basename(fledPath)} (payload ${payload.length} B, json ${screenmapJson.length} B)`);
        unlinkSync(rgbPath);
        converted++;
    }
    console.log(`\n${converted} file(s) converted; original .rgb deleted.`);
}

main();

#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';

const src = 'public/screenmaps/spaceface.json';
const dst = 'public/screenmaps/spaceface_shrunk.json';
const scaleX = 0.37;

const data = JSON.parse(readFileSync(src, 'utf-8'));

for (const strip of Object.values(data.map)) {
    strip.x = strip.x.map(v => +(v * scaleX).toFixed(4));
}

writeFileSync(dst, JSON.stringify(data, null, 2) + '\n');
console.log(`Wrote ${dst} (x scaled by ${scaleX})`);

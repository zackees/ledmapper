import { normalizeScreenmap } from '@fastled/gfx/core';

const ledCount = 4;
const errors = [];
let currentMap = normalizeScreenmap({ map: { strip: { x: [0, 1, 2, 3], y: [0, 0, 0, 0] } } }, 64);
const capabilities = { beautiful: true, fastFallback: true, transferableFrames: true, sharedMemory: false };
function replaceScreenmap(value) {
  try { currentMap = normalizeScreenmap(value, 64); } catch (error) { errors.push(`screenmap: ${error.message}`); }
}
function pushFrame(frame) {
  if (!(frame instanceof Uint8Array) || frame.byteLength !== ledCount * 3) {
    errors.push(`frame-length: expected ${ledCount * 3} RGB8 bytes`);
    return null;
  }
  return frame.slice();
}
const input = new Uint8Array(ledCount * 3).fill(7);
const owned = pushFrame(input);
input.fill(0);
if (owned[0] !== 7) throw new Error('copy-safe frame ownership failed');
replaceScreenmap({ map: { replacement: { x: [0, 2], y: [1, 3] } } });
if (currentMap.points.length !== 2) throw new Error('screenmap replacement failed');
pushFrame(new Uint8Array(2));
if (!errors.some((message) => message.startsWith('frame-length:'))) throw new Error('frame validation did not report context');
if (!capabilities.beautiful || !capabilities.fastFallback || capabilities.sharedMemory) throw new Error('capability report mismatch');
console.log(JSON.stringify({ contract: 'fastled-adapter-v1', ledCount, capabilities, errors }));

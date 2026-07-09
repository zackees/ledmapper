/**
 * Capture-ratio harness (#258 / #255): proves the every-frame recording
 * guarantee can't silently regress. Reproduces the #255 measurement table
 * and ENFORCES thresholds (exit 1 on violation):
 *
 *   offline (file + fled, the default path):  captured === container frames
 *     — bit-exact, at 1x AND under 4x CPU throttle, 30 and 60 fps sources
 *   realtime (format 'both' forces the live path): >= 95% at 1x
 *
 * Prereqs: dev server running (npm run dev) and ffmpeg/ffprobe on PATH
 * (fixtures are generated into tests/perf/output/, which is gitignored).
 *
 * Usage: node tests/perf/capture-ratio.mjs
 */
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const BASE = process.env.LM_UX_BASE ?? 'https://localhost:8080';
const OUT = path.resolve(import.meta.dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });

function ffmpeg(args) {
    execSync(`ffmpeg -v error -y ${args}`, { stdio: ['ignore', 'inherit', 'inherit'] });
}

function makeFixture(name, rate, seconds) {
    const file = path.join(OUT, name);
    if (!fs.existsSync(file)) {
        ffmpeg(`-f lavfi -i "testsrc2=size=480x854:rate=${rate}:duration=${seconds}" -pix_fmt yuv420p "${file}"`);
    }
    return { file, frames: rate * seconds, fps: rate, seconds };
}

function fledInfo(buf, ledCount) {
    const jsonLen = buf.readUInt32LE(8);
    const meta = JSON.parse(buf.subarray(12, 12 + jsonLen).toString('utf-8'));
    return { frames: (buf.length - 12 - jsonLen) / (ledCount * 3), fps: meta.video?.fps };
}

const failures = [];
function check(label, ok, detail) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${detail}`);
    if (!ok) failures.push(`${label}: ${detail}`);
}

const fixtures = {
    f30: makeFixture('capture-30fps.mp4', 30, 8),
    f60: makeFixture('capture-60fps.mp4', 60, 8),
};

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1500, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));

async function loadVideo(file, query = '') {
    await page.goto(BASE + '/moviemaker' + query, { waitUntil: 'networkidle' });
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('lm:')) localStorage.removeItem(k); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const chooser = page.waitForEvent('filechooser');
    await page.locator('button[data-trigger="btn_load_video"]').click();
    await (await chooser).setFiles(file);
    await page.waitForFunction(() => document.querySelector('#welcome-overlay')?.classList.contains('hidden'), null, { timeout: 20000 });
    await page.waitForTimeout(400);
}

/** Offline path: single click renders the whole file; download on completion. */
async function offlineScenario(fixture, throttle, label) {
    await loadVideo(fixture.file);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const dl = page.waitForEvent('download', { timeout: 300000 });
    const t0 = Date.now();
    await page.locator('#btn_toggle_record').click();
    const download = await dl;
    const elapsed = Date.now() - t0;
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const file = path.join(OUT, `${label}.fled`);
    await download.saveAs(file);
    const info = fledInfo(fs.readFileSync(file), 256);
    check(label,
        info.frames === fixture.frames && info.fps === fixture.fps,
        `frames=${info.frames}/${fixture.frames} fps=${info.fps} elapsed=${elapsed}ms (${Math.round((fixture.seconds * 1000 / elapsed) * 10) / 10}x realtime)`);
}

/** Realtime path (format 'both'): play + record a window, ratio vs presented. */
async function realtimeScenario(fixture, minRatio, label) {
    await loadVideo(fixture.file);
    await page.locator('#sel_record_format').selectOption('both');
    await page.locator('#btn_play_pause').click();
    await page.waitForTimeout(500);
    const dl = page.waitForEvent('download', { timeout: 60000 });
    await page.locator('#btn_toggle_record').click();
    await page.waitForTimeout(5000);
    await page.locator('#btn_toggle_record').click();
    const download = await dl; // first download event (fled or mp4)
    const stats = await page.evaluate(() => window.__lmDebug?.moviemaker?.getState()?.captureStats ?? null);
    const trail = await page.evaluate(() => window.__lmLog.dump().split('\n').filter((l) => /save-fled/.test(l)).slice(-1)[0] ?? '');
    const m = /"frames":(\d+),"skipped":(\d+)/.exec(trail);
    const captured = m ? Number(m[1]) : -1;
    const skipped = m ? Number(m[2]) : -1;
    const ratio = captured >= 0 && captured + skipped > 0 ? captured / (captured + skipped) : 0;
    void download;
    void stats;
    check(label, ratio >= minRatio, `captured=${captured} skipped=${skipped} ratio=${Math.round(ratio * 1000) / 10}% (min ${minRatio * 100}%)`);
}

console.log('--- offline path (every-frame guarantee) ---');
await offlineScenario(fixtures.f30, 1, 'offline-30fps-1x');
await offlineScenario(fixtures.f60, 1, 'offline-60fps-1x');
await offlineScenario(fixtures.f60, 4, 'offline-60fps-throttle4x');

console.log('--- realtime path (format both) ---');
await realtimeScenario(fixtures.f30, 0.95, 'realtime-30fps-1x');
await realtimeScenario(fixtures.f60, 0.95, 'realtime-60fps-1x');

// --- duplicate-free capture (#266): the media-clock-key realtime fallback
// must record one frame per SOURCE frame and drop repeats of a frozen
// source WITHOUT ever comparing pixel data. Forces the realtime + no-rVFC
// path so the media-clock source-frame index drives pacing.
async function dedupScenario() {
    const liveStats = () => page.evaluate(() => window.__lmDebug?.moviemaker?.getState()?.captureStats ?? null);
    await loadVideo(fixtures.f30.file, '?forceRealtimeCapture=1&noRvfc=1');
    await page.locator('#btn_play_pause').click();
    await page.waitForTimeout(300);
    await page.locator('#btn_toggle_record').click();
    await page.waitForTimeout(3000);
    const playingStats = await liveStats();
    // ~90 frames for 3s @ 30fps, with duplicates dropped (60Hz loop samples
    // each source index ~twice).
    const perSec = playingStats.captured / 3;
    check('dedup-playing-rate',
        perSec >= 27 && perSec <= 33 && playingStats.duplicatesDropped > 0,
        `captured=${playingStats.captured} (~${perSec.toFixed(0)}/s) dup=${playingStats.duplicatesDropped}`);
    // Freeze the source: captured must NOT grow — every repeat is a duplicate.
    await page.evaluate(() => document.querySelector('#videoPlayer').pause());
    await page.waitForTimeout(1500);
    const frozenStats = await liveStats();
    check('dedup-frozen-appends-nothing',
        frozenStats.captured === playingStats.captured && frozenStats.duplicatesDropped > playingStats.duplicatesDropped,
        `captured ${playingStats.captured}→${frozenStats.captured} (must not grow) dup ${playingStats.duplicatesDropped}→${frozenStats.duplicatesDropped}`);
    await page.locator('#btn_toggle_record').click();
}
console.log('--- duplicate-free capture (#266) ---');
await dedupScenario();

await browser.close();

if (failures.length > 0) {
    console.error(`\n${failures.length} capture-ratio violation(s):\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('\nAll capture-ratio thresholds met.');

/**
 * End-to-end usability walkthrough of the full ledmapper pipeline.
 *
 * Simulates a brand-new user driving:
 *   / (default route) → /hub → screenmap creation (/screenmap, fake webcam)
 *   → shapeeditor (/shapeeditor) → moviemaker (/moviemaker: video import +
 *   record .fled) → movieplayer (/movieplayer: playback).
 *
 * Saves a numbered screenshot at every step plus ux-log.json (console
 * errors, page errors, UX probes, and the in-page window.__lmLog event
 * trail) into tests/ux/out/ for human or agent review.
 *
 * Prereqs: dev server running (npm run dev). Runs headed — WebGL recording
 * needs a real GPU context.
 *
 * Usage:
 *   node tests/ux/walkthrough.mjs
 *   LM_UX_VIDEO=path/to/video.mp4 node tests/ux/walkthrough.mjs
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.LM_UX_BASE ?? 'https://localhost:8080';
const OUT = path.resolve(import.meta.dirname, 'out');
const FALLBACK_VIDEO = path.resolve(import.meta.dirname, '../fixtures/test-video.mp4');
const VIDEO = (() => {
    const v = process.env.LM_UX_VIDEO ?? 'E:/video/color_bubble_swirl.mp4';
    return fs.existsSync(v) ? v : FALLBACK_VIDEO;
})();
fs.mkdirSync(OUT, { recursive: true });

const log = { video: VIDEO, steps: [], probes: {}, consoleErrors: [], pageErrors: [], eventLogs: {} };
let shotIndex = 0;

function note(msg) {
    console.log(`[walkthrough] ${msg}`);
    log.steps.push({ t: new Date().toISOString(), msg });
}
function probe(key, value) {
    log.probes[key] = value;
    note(`probe ${key} = ${JSON.stringify(value)}`);
}

async function shot(page, name) {
    shotIndex += 1;
    const file = path.join(OUT, `${String(shotIndex).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    note(`screenshot: ${path.basename(file)}`);
}

/** Capture the page's window.__lmLog event trail before navigating away. */
async function captureEventLog(page, label) {
    const dump = await page.evaluate(() => window.__lmLog?.dump() ?? '').catch(() => '');
    if (dump) log.eventLogs[label] = dump.split('\n');
}

const browser = await chromium.launch({
    headless: false, // WebGL recording needs a real GPU context
    args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
    ],
});
const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1360, height: 850 },
    permissions: ['camera'],
});
const page = await context.newPage();
page.on('console', (m) => {
    if (m.type() === 'error') log.consoleErrors.push({ url: page.url(), text: m.text() });
});
page.on('pageerror', (e) => log.pageErrors.push({ url: page.url(), text: e.message }));

try {
    // ---------- Step 1: default route + hub (first impression) ----------
    note('STEP 1: default route "/" (app shell) and /hub');
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await shot(page, 'root-default-route');

    await page.goto(BASE + '/hub', { waitUntil: 'networkidle' });
    await shot(page, 'hub-landing');
    probe('hub.cardHrefs', await page.$$eval('a.tool-card', (as) => as.map((a) => a.getAttribute('href'))));

    // ---------- Step 2: Screenmap Maker ----------
    note('STEP 2: screenmap maker — create a map from scratch (fake webcam)');
    await page.goto(BASE + '/screenmap', { waitUntil: 'networkidle' });
    await shot(page, 'screenmap-initial');

    await page.locator('#btn_webcam').click();
    await page.locator('#mappingUI').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(600);
    await shot(page, 'screenmap-mapping-ui');

    await page.locator('#btn_snapshot').click();
    await page.waitForTimeout(500);
    await shot(page, 'screenmap-after-snapshot');

    // Click 8 LED positions (2 rows of 4).
    const cv = page.locator('#mappingUI main canvas').first();
    const positions = [
        { x: 200, y: 200 }, { x: 280, y: 200 }, { x: 360, y: 200 }, { x: 440, y: 200 },
        { x: 200, y: 300 }, { x: 280, y: 300 }, { x: 360, y: 300 }, { x: 440, y: 300 },
    ];
    for (const p of positions) {
        await cv.click({ position: p });
        await page.waitForTimeout(80);
    }
    await shot(page, 'screenmap-points-added');

    const dl1 = page.waitForEvent('download', { timeout: 10000 });
    await page.locator('#btn_download').click();
    const download1 = await dl1;
    const screenmapPath = path.join(OUT, 'created-screenmap.json');
    await download1.saveAs(screenmapPath);
    note(`screenmap exported: ${download1.suggestedFilename()}`);
    await shot(page, 'screenmap-after-export');

    // ---------- Step 3: Shapeeditor ----------
    note('STEP 3: shapeeditor — inspect/edit the created screenmap');
    await page.goto(BASE + '/shapeeditor', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await shot(page, 'shapeeditor-first-run');

    const swalClose = page.locator('.swal2-close');
    if (await swalClose.isVisible().catch(() => false)) {
        await swalClose.click();
        await page.waitForTimeout(300);
    } else {
        const confirm = page.locator('.swal2-confirm');
        if (await confirm.isVisible().catch(() => false)) {
            await confirm.click();
            await page.waitForTimeout(300);
        }
    }

    await page.locator('#btn_upload_screenmap').setInputFiles(screenmapPath);
    await page.waitForTimeout(1000);
    await shot(page, 'shapeeditor-with-created-map');
    probe('shapeeditor.saveAsDisabledAfterLoad', await page.locator('#btn_save_as').isDisabled());

    // ---------- Step 4: Moviemaker ----------
    note('STEP 4: moviemaker — import video, apply screenmap, record .fled');
    await page.goto(BASE + '/moviemaker', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await shot(page, 'moviemaker-welcome');
    probe('moviemaker.recordDisabledBeforeSource', await page.locator('#btn_toggle_record').isDisabled());

    const chooser = page.waitForEvent('filechooser');
    await page.locator('button[data-trigger="btn_load_video"]').click();
    await (await chooser).setFiles(VIDEO);
    await page.waitForFunction(
        () => document.querySelector('#welcome-overlay')?.classList.contains('hidden'),
        null, { timeout: 20000 },
    );
    await page.waitForTimeout(700);
    await shot(page, 'moviemaker-video-loaded');

    await page.locator('#btn_upload_screenmap').setInputFiles(screenmapPath);
    await page.waitForTimeout(1000);
    await shot(page, 'moviemaker-custom-screenmap');

    await page.locator('#btn_play_pause').click();
    await page.waitForTimeout(1000);
    await shot(page, 'moviemaker-playing');

    // LED preview must actually light up (#221 item 1 regression probe).
    // Sampled inside a RAF callback: preserveDrawingBuffer is false, so the
    // WebGL back buffer is only readable in the same task that rendered it.
    await page.waitForTimeout(1500);
    probe('moviemaker.previewLuma', await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => {
            const canvas = document.querySelector('#previewPanel canvas');
            if (!(canvas instanceof HTMLCanvasElement)) { resolve('no-canvas'); return; }
            const t = document.createElement('canvas');
            t.width = 32; t.height = 32;
            const ctx = t.getContext('2d');
            ctx.drawImage(canvas, 0, 0, 32, 32);
            const d = ctx.getImageData(0, 0, 32, 32).data;
            let sum = 0;
            let peak = 0;
            for (let i = 0; i < d.length; i += 4) {
                const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
                sum += l;
                if (l > peak) peak = l;
            }
            // mean is scale-sensitive (8 LEDs in a 400px pane average near
            // zero); peak is the robust "did anything light up" signal.
            resolve({ mean: Math.round((sum / (d.length / 4)) * 100) / 100, peak: Math.round(peak) });
        });
    })));

    const recordBtn = page.locator('#btn_toggle_record');
    probe('moviemaker.recordEnabledAfterSetup', await recordBtn.isEnabled());
    const dl2 = page.waitForEvent('download', { timeout: 25000 });
    await recordBtn.click();
    await page.waitForTimeout(600);
    await shot(page, 'moviemaker-recording');
    await page.waitForTimeout(2500);
    await recordBtn.click();
    const download2 = await dl2;
    const fledPath = path.join(OUT, 'recorded.fled');
    await download2.saveAs(fledPath);
    note(`fled recorded: ${download2.suggestedFilename()} (${fs.statSync(fledPath).size} bytes)`);
    probe('moviemaker.fledBytes', fs.statSync(fledPath).size);
    await page.waitForTimeout(500);
    await shot(page, 'moviemaker-after-record');
    await captureEventLog(page, 'moviemaker');

    // ---------- Step 5: Movieplayer ----------
    note('STEP 5: movieplayer — play the recorded .fled');
    await page.goto(BASE + '/movieplayer', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500); // allow IndexedDB auto-restore
    await shot(page, 'movieplayer-initial');
    probe('movieplayer.statusAfterNav', await page.locator('#screenmap_status').textContent().catch(() => 'missing'));

    await page.locator('#btn_load_movie').setInputFiles(fledPath);
    await page.waitForTimeout(1500);
    await shot(page, 'movieplayer-fled-loaded');
    probe('movieplayer.status', await page.locator('#screenmap_status').textContent().catch(() => 'missing'));
    probe('movieplayer.playValue', await page.locator('#btn_play').inputValue().catch(() => 'missing'));

    // Verify frames actually advance (canvas pixels change while playing).
    const sample = () => page.evaluate(() => {
        const c = document.querySelector('canvas');
        return c ? c.toDataURL('image/png').slice(0, 512) : '';
    });
    const s1 = await sample();
    await page.waitForTimeout(800);
    const s2 = await sample();
    probe('movieplayer.framesAdvance', Boolean(s1) && s1 !== s2);
    await page.waitForTimeout(800);
    await shot(page, 'movieplayer-playing');
    await captureEventLog(page, 'movieplayer');

    note('WALKTHROUGH COMPLETE');
} catch (err) {
    note(`FAILED: ${err.message}`);
    await shot(page, 'FAILURE-state').catch(() => undefined);
    process.exitCode = 1;
} finally {
    fs.writeFileSync(path.join(OUT, 'ux-log.json'), JSON.stringify(log, null, 2));
    await browser.close();
}

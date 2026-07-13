import { parseScreenmapMultiStrip, centerAndFitPoints, getStripColors, stripStartEndLabels } from '../common';
import { createLabelRenderer } from '../label-render';
import { wireFileSource, fileHasExtension } from '../drag-drop';
import { errorDialog } from '../ui/dialogs';
import { saveVideo, getVideo, clearVideo } from '../video-store';
import { createGfx, wireBloomUi, createPlayer } from '@fastled/gfx';
import { createCanvasRecorder } from '../render/canvas-recorder';
import { buildVideoChannelMap, parseRgbFrames, hasFledMagic, readVideoFps } from '@fastled/gfx/core';
import type { ParsedStrip } from '../types/domain';
import type { Player } from '@fastled/gfx';
import { createLogger } from '../debug-log';
import { registerDebugState, unregisterDebugState, type MovieplayerDebugState } from '../debug-registry';

const log = createLogger('movieplayer');
import templateHtml from './template.html?raw';
export { default as css } from './movieplayer.css?url';

function qe<T extends HTMLElement>(parent: ParentNode, sel: string, _cast?: (e: Element) => T): T {
    const el = parent.querySelector(sel);
    if (!el) throw new Error(`Missing element "${sel}"`);
    return el as T;
}

// Placeholder so `createGfx` can instantiate before a video is loaded.
// Replaced via `gfx.setScreenmap` on every load.
const PLACEHOLDER_SCREENMAP = {
    map: { strip1: { x: [0], y: [0], diameter: 0.25 } },
};

/** Index of the brightest frame — a visibly-lit poster for a paused (restored)
 *  load, since frame 0 is often a black fade-in. Cheap one-time scan at load. */
function brightestFrameIndex(frames: Uint8Array[]): number {
    let best = 0;
    let bestSum = -1;
    for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (!f) continue;
        let s = 0;
        for (const b of f) s += b;
        if (s > bestSum) { bestSum = s; best = i; }
    }
    return best;
}

export function init(container: HTMLElement) {
    container.innerHTML = templateHtml;

    const dom_btn_load_movie = qe<HTMLInputElement>(container, '#btn_load_movie');
    const dom_btn_play = qe<HTMLInputElement>(container, '#btn_play');
    const dom_btn_record = qe<HTMLInputElement>(container, '#btn_record');
    const dom_rng_diameter = qe<HTMLInputElement>(container, '#rng_diameter');
    const dom_txt_curr_diameter = qe<HTMLElement>(container, '#txt_curr_diameter');
    const dom_movie_drop_target = qe<HTMLElement>(container, '#movie_drop_target');
    const dom_screenmap_status = qe<HTMLElement>(container, '#screenmap_status');
    const dom_chk_auto_bloom        = qe<HTMLInputElement>(container, '#chk_auto_bloom');
    const dom_bloom_strength_slider = qe<HTMLElement>(container, '#bloom_strength_slider');
    const dom_rng_bloom_strength    = qe<HTMLInputElement>(container, '#rng_bloom_strength');
    const dom_txt_bloom_strength    = qe<HTMLElement>(container, '#txt_curr_bloom_strength');

    dom_btn_play.disabled = true;

    const CANVAS_SIZE = 1000;

    let screenmap_pts: [number, number][] = [];
    let screenmap_strips: ParsedStrip[] = [];
    let player: Player | null = null;
    let frameCount = 0;

    const ac = new AbortController();
    const { signal } = ac;

    // Live per-tool debug state on window.__lmDebug, ships always-on (prod
    // included) — consumed by the copy-diagnostics payload and by
    // Playwright assertions in place of brittle DOM/class probes. #225.
    function getMovieplayerDebugState(): MovieplayerDebugState {
        return {
            frameCount,
            ledCount: screenmap_pts.length,
            playing: player?.playing ?? false,
            loaded: player !== null,
        };
    }
    registerDebugState('movieplayer', { getState: getMovieplayerDebugState });

    const main = qe<HTMLElement>(container, 'main');

    // gfx package owns renderer + bloom + animation loop + overlay canvas.
    // `preserveDrawingBuffer: true` lets the recorder readback via
    // canvas.captureStream(). The screenmap is a placeholder until the
    // first .fled file lands; the bloom UI persists its auto/manual flag
    // under a movieplayer-scoped localStorage key.
    const gfx = createGfx({
        screenmap: PLACEHOLDER_SCREENMAP,
        parent: main,
        paneSize: CANVAS_SIZE,
        enableOverlay: true,
        preserveDrawingBuffer: true,
        signal,
    });
    if (!gfx.overlayCanvas || !gfx.overlayCtx) {
        throw new Error('movieplayer: gfx overlay not provisioned');
    }
    const overlayCanvas = gfx.overlayCanvas;
    const overlayCtx = gfx.overlayCtx;
    const wrapper = gfx.wrapper;
    // Labels only — let mouse events fall through to the renderer canvas.
    overlayCanvas.style.pointerEvents = 'none';

    wireBloomUi({
        gfx,
        chk: dom_chk_auto_bloom,
        slider: dom_rng_bloom_strength,
        sliderWrap: dom_bloom_strength_slider,
        label: dom_txt_bloom_strength,
        lsKey: 'ledmapper.movieplayer.autoBloom',
        signal,
    });

    // Canvas-overlay play/pause button — the primary playback affordance.
    // Shown only once a video is loaded and mirrors the playing state.
    const dom_btn_play_overlay = document.createElement('button');
    dom_btn_play_overlay.type = 'button';
    dom_btn_play_overlay.id = 'btn_play_overlay';
    dom_btn_play_overlay.className = 'play-overlay';
    dom_btn_play_overlay.setAttribute('aria-label', 'Play');
    dom_btn_play_overlay.hidden = true;
    wrapper.appendChild(dom_btn_play_overlay);

    // Diameter slider bound directly to gfx.setDiameter.
    dom_rng_diameter.addEventListener('input', () => {
        const px = parseInt(dom_rng_diameter.value) || 1;
        gfx.setDiameter(px);
        dom_txt_curr_diameter.textContent = String(px);
    }, { signal });

    // Draw per-strip Start/End labels over the LED view. Multi-strip maps
    // get one color per strip; single-strip maps use white. Redrawn only
    // on screenmap load — positions are static.
    const labelRenderer = createLabelRenderer();

    function drawStripLabels() {
        overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        if (screenmap_strips.length === 0 || screenmap_pts.length === 0) return;
        const colors = screenmap_strips.length > 1
            ? getStripColors(screenmap_strips.length)
            : ['white'];
        const items: { id: string; text: string; anchorX: number; anchorY: number; color: string }[] = [];
        for (let si = 0; si < screenmap_strips.length; si++) {
            const strip = screenmap_strips[si];
            if (!strip) continue;
            const first = strip.offset;
            const last = strip.offset + strip.count - 1;
            if (strip.count === 0 || last >= screenmap_pts.length) continue;
            const { start, end } = stripStartEndLabels(strip, si);
            const ptFirst = screenmap_pts[first] ?? [0, 0];
            const ptLast = screenmap_pts[last] ?? [0, 0];
            items.push({ id: `start:${String(si)}`, text: start, anchorX: ptFirst[0], anchorY: ptFirst[1], color: colors[si] ?? 'white' });
            if (end !== null) {
                items.push({ id: `end:${String(si)}`, text: end, anchorX: ptLast[0], anchorY: ptLast[1], color: colors[si] ?? 'white' });
            }
        }
        labelRenderer.draw(overlayCtx, items, {
            font: 'bold 18px monospace',
            bounds: { x: 0, y: 0, w: CANVAS_SIZE, h: CANVAS_SIZE },
            obstacles: () => screenmap_pts.map(([x, y]) => ({ x: x - 3, y: y - 3, w: 6, h: 6 })),
        });
    }

    // Strip lines + Start/End markers are hidden during playback; they are
    // revealed only while the pointer is over the canvas (issue #66).
    let overlayHovered = false;
    function refreshStripOverlay() {
        if (overlayHovered) drawStripLabels();
        else overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }
    wrapper.addEventListener('mouseenter', () => { overlayHovered = true; refreshStripOverlay(); }, { signal });
    wrapper.addEventListener('mouseleave', () => { overlayHovered = false; refreshStripOverlay(); }, { signal });

    function setStatus(text: string, loaded: boolean) {
        dom_screenmap_status.textContent = text;
        dom_screenmap_status.classList.toggle('loaded', loaded);
    }

    /**
     * Apply a screenmap parsed from a FLED file's embedded JSON to the scene.
     * Returns false (and surfaces no UI) if the JSON couldn't be parsed.
     */
    function applyEmbeddedScreenmap(jsonText: string): boolean {
        let parsed;
        try {
            parsed = parseScreenmapMultiStrip(jsonText);
        } catch (error) {
            log.error('embedded-screenmap-parse-error', { error: String(error) });
            return false;
        }
        if (parsed.allPoints.length === 0) return false;
        screenmap_strips = parsed.strips;
        screenmap_pts = centerAndFitPoints(parsed.allPoints, CANVAS_SIZE, CANVAS_SIZE);
        // Hand the raw JSON to gfx so the package owns the centered/fitted
        // points internally. We keep our own copy too for the overlay code.
        gfx.setScreenmap(JSON.parse(jsonText) as Record<string, unknown>);
        refreshStripOverlay();
        return true;
    }

    function loadMovieFile(file: File | null | undefined) {
        if (!file) return;
        teardownPlayer();
        if (!fileHasExtension(file, ['.fled'])) {
            void errorDialog('Wrong file type', 'Please choose a .fled video file (recorded by the Mapped Video Maker).');
            return;
        }
        void file.arrayBuffer().then((buf) => { load_movie_data(buf); }).catch((error: unknown) => {
            void errorDialog('Error reading video file', String(error));
        });
    }

    // On startup, restore any previously-loaded video from IndexedDB. Legacy
    // headerless blobs (pre-FLED) are dropped silently — this player only
    // accepts videos with an embedded screenmap.
    void getVideo().then((bytes) => {
        if (!bytes) return;
        if (!hasFledMagic(bytes)) {
            void clearVideo();
            return;
        }
        load_movie_data(bytes.slice().buffer, { persist: false, autoplay: false, silent: true });
    }).catch((error: unknown) => {
        // IndexedDB read failed (quota, permission, corruption). #179.
        log.error('restore-from-indexeddb-failed', { error: String(error) });
        void errorDialog('Could not restore your last video', String(error));
    });

    function set_dom_btn_play(on: boolean) {
        dom_btn_play.value = on ? 'Pause' : 'Play';
        // The overlay button only appears once a video is loaded; it reflects
        // the playing state.
        dom_btn_play_overlay.hidden = frameCount === 0;
        dom_btn_play_overlay.classList.toggle('is-playing', on);
        dom_btn_play_overlay.setAttribute('aria-label', on ? 'Pause' : 'Play');
    }

    function togglePlay() {
        if (!player) return;
        if (player.playing) player.pause();
        else player.play();
        set_dom_btn_play(player.playing);
    }

    dom_btn_play.addEventListener('click', togglePlay, { signal });
    dom_btn_play_overlay.addEventListener('click', () => {
        if (frameCount === 0) return;
        togglePlay();
    }, { signal });

    // Native canvas recording. Encoding runs off the main thread via
    // MediaRecorder + captureStream, so the render loop does zero extra
    // work per frame — recording on vs. off is identical.
    const recorder = createCanvasRecorder({
        canvas: gfx.canvas,
        fps: 60,
        onError: (m) => { void errorDialog('Recording error', m); },
    });
    if (!recorder.isSupported) dom_btn_record.disabled = true;

    function set_dom_btn_record(on: boolean) {
        // "Export video" (not "Record") — in a player, "Record" reads as
        // "go make a .fled", but this button screen-captures the current LED
        // playback to a video file (issue #294).
        dom_btn_record.value = on ? 'Stop' : 'Export video';
        dom_btn_record.classList.toggle('recording', on);
    }

    dom_btn_record.addEventListener('click', () => {
        set_dom_btn_record(recorder.toggle());
    }, { signal });

    // Each loaded video gets its own Player. Tear down the previous one so
    // its RAF loop stops driving pushFrame.
    function teardownPlayer() {
        if (player) {
            player.pause();
            player = null;
        }
        frameCount = 0;
    }

    // Pre-apply the video-channel remap once at load time so the per-frame
    // render path can hand bytes straight to gfx.pushFrame with no
    // remapping work. Identity-map screenmaps (no explicit video_offsets)
    // skip the copy entirely.
    function applyChannelMap(frames: Uint8Array[], channelMap: Int32Array | null, ledCount: number): Uint8Array[] {
        if (!channelMap) return frames;
        const remapped: Uint8Array[] = new Array<Uint8Array>(frames.length);
        for (let f = 0; f < frames.length; f++) {
            const src = frames[f];
            if (!src) continue;
            const dst = new Uint8Array(ledCount * 3);
            for (let i = 0; i < ledCount; i++) {
                const i3 = i * 3;
                const c3 = (channelMap[i] ?? i) * 3;
                dst[i3    ] = src[c3    ] ?? 0;
                dst[i3 + 1] = src[c3 + 1] ?? 0;
                dst[i3 + 2] = src[c3 + 2] ?? 0;
            }
            remapped[f] = dst;
        }
        return remapped;
    }

    function load_movie_data(array_buffer: ArrayBuffer, { persist = true, autoplay = true, silent = false } = {}) {
        const uint8_array = new Uint8Array(array_buffer);
        // Two-pass parse: peek the header to extract embedded JSON, derive
        // ledCount from it, then re-slice frames against the derived count.
        const peek = parseRgbFrames(uint8_array, 0);
        if (!peek.isFled || peek.embeddedJson === null) {
            if (silent) { void clearVideo(); return; }
            void errorDialog('No embedded screenmap', 'This video has no embedded screenmap. Re-record with the latest Mapped Video Maker.');
            return;
        }
        if (peek.fledError !== null) {
            if (silent) { void clearVideo(); return; }
            void errorDialog('Unsupported video file', peek.fledError);
            return;
        }
        if (!applyEmbeddedScreenmap(peek.embeddedJson)) {
            if (silent) { void clearVideo(); return; }
            void errorDialog('Invalid embedded screenmap', 'Embedded screenmap in this video is invalid or empty.');
            return;
        }

        const parsed = parseRgbFrames(uint8_array, screenmap_pts.length);
        if (parsed.notMultiple) {
            log.info('load-failed', { reason: 'payload-mismatch', bytes: uint8_array.length });
            if (silent) { void clearVideo(); return; }
            void errorDialog('Corrupted video', 'Video payload does not match the embedded screenmap — file may be corrupted.');
            return;
        }
        const channelMap = buildVideoChannelMap(screenmap_strips, screenmap_pts.length);
        const frames = applyChannelMap(parsed.frames, channelMap, screenmap_pts.length);
        teardownPlayer();
        // The spec-defined optional `video.fps` metadata key (#256,
        // docs/fled-format.md) — recordings of non-30fps sources play at
        // source speed. Absent/invalid → the historical 30 fps default.
        const metaFps = readVideoFps(peek.embeddedJson) ?? 30;
        player = createPlayer({
            frames,
            fps: metaFps,
            autoplay,
            pushFrame: (rgb) => { gfx.pushFrame(rgb); },
        });
        // Per-frame: drive the recorder's blit from gfx's render loop via
        // onTimeUpdate (fires whenever the player advances time). The
        // recorder is a no-op when not recording.
        player.onTimeUpdate(() => { recorder.captureFrame(); });
        player.onEnded(() => { set_dom_btn_play(false); });
        frameCount = frames.length;
        dom_btn_play.disabled = false;
        if (persist) {
            saveVideo(uint8_array).catch((error: unknown) => {
                log.error('persist-to-indexeddb-failed', { error: String(error) });
                // Quota / permission errors surface to the user — the
                // video plays this session but won't auto-restore later.
                void errorDialog('Could not save video for next session', `Storage error: ${String(error)}\n\nThe video will play now but won't auto-restore on your next visit.`);
            });
        }
        // Restored sessions load paused (autoplay:false). The very first frame
        // is often a black fade-in (offline capture demuxes from the video's
        // start), so render the brightest frame as a static poster — the canvas
        // shows the LEDs instead of sitting black next to a filled-in status,
        // which read as broken (issue #293). This only sets what's displayed;
        // the player's clock stays at 0, so pressing Play still starts from the
        // beginning. Playing sources render on their own.
        if (!player.playing && frames.length > 0) {
            const poster = frames[brightestFrameIndex(frames)];
            if (poster) gfx.pushFrame(poster);
        }
        log.info('movie-loaded', {
            leds: screenmap_pts.length,
            frames: frameCount,
            fps: metaFps,
            autoplay,
            source: persist ? 'file' : 'indexeddb-restore',
        });
        // A file the user just picked shows the plain stats; a video restored
        // from the last session says so, so the filled-in status alongside the
        // browser's "No file chosen" (which we cannot set) reads coherently.
        const stats = `${String(screenmap_pts.length)} LEDs · ${String(frameCount)} frames · ${String(metaFps)} fps`;
        setStatus(persist ? stats : `${stats} · restored from last session`, true);
        set_dom_btn_play(player.playing);
    }

    wireFileSource({
        input: dom_btn_load_movie,
        target: dom_movie_drop_target,
        onFile: loadMovieFile,
        signal,
    });

    return function destroy() {
        unregisterDebugState('movieplayer');
        teardownPlayer();
        recorder.stop();
        ac.abort();
        gfx.dispose();
    };
}

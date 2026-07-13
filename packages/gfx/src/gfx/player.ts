/**
 * Headless playback controller for `createGfxFromFled`.
 *
 * Owns the time axis. Drives `gfx.pushFrame` from its own RAF loop
 * when playing. UI is opt-in via `mountControls(el)`; the controller
 * itself has no DOM dependencies and is fully unit-testable.
 *
 * State machine:
 *   - playing/paused
 *   - currentTime (clamped to [0, duration])
 *   - speed (positive float; 0.25..4 reasonable, no enforced cap)
 *   - loop (wrap at end vs. fire `onEnded`)
 *
 * The clock advances by wall-time deltas, not by counting frames, so
 * varying RAF cadence (background tab, slow GPU) doesn't drift the
 * playhead off-time.
 */

import { setupToggleButton } from './controls/toggle-button';
import type { Player, PlayerControlsOptions } from './types';

export interface PlayerInit {
    frames: readonly Uint8Array[];
    fps: number;
    autoplay: boolean;
    pushFrame: (rgb: Uint8Array) => void;
    /** Injectable clock for tests. Defaults to performance.now(). */
    now?: () => number;
    /** Injectable RAF for tests. Defaults to requestAnimationFrame. */
    raf?: (cb: (t: number) => void) => number;
    cancelRaf?: (id: number) => void;
}

export function createPlayer(init: PlayerInit): Player {
    const frames = init.frames;
    const fps = init.fps > 0 ? init.fps : 30;
    const frameCount = frames.length;
    const duration = frameCount > 0 ? frameCount / fps : 0;
    const now = init.now ?? (() => performance.now());
    const raf = init.raf ?? ((cb: (t: number) => void) => requestAnimationFrame(cb));
    const cancelRaf = init.cancelRaf ?? ((id: number) => { cancelAnimationFrame(id); });

    let playing = false;
    let currentTime = 0;
    let speed = 1;
    let loop = true;
    let lastTickMs = 0;
    let rafId: number | null = null;
    const timeListeners = new Set<(t: number) => void>();
    const endedListeners = new Set<() => void>();
    let controlsDispose: (() => void) | null = null;

    function pushCurrentFrame() {
        if (frameCount === 0) return;
        const idx = Math.min(Math.max(Math.floor(currentTime * fps), 0), frameCount - 1);
        const f = frames[idx];
        if (f) init.pushFrame(f);
    }

    function tick(timeMs: number) {
        rafId = null;
        if (!playing) return;
        const dt = (timeMs - lastTickMs) / 1000;
        lastTickMs = timeMs;
        currentTime += dt * speed;
        if (currentTime >= duration) {
            if (loop) {
                currentTime = duration > 0 ? currentTime % duration : 0;
            } else {
                currentTime = duration;
                playing = false;
                pushCurrentFrame();
                emitTime();
                for (const cb of endedListeners) cb();
                return;
            }
        } else if (currentTime < 0) {
            currentTime = loop ? Math.max(currentTime + duration, 0) : 0;
        }
        pushCurrentFrame();
        emitTime();
        rafId = raf(tick);
    }

    function emitTime() {
        for (const cb of timeListeners) cb(currentTime);
    }

    function play() {
        if (playing || frameCount === 0) return;
        playing = true;
        lastTickMs = now();
        rafId = raf(tick);
    }
    function pause() {
        playing = false;
        if (rafId !== null) {
            cancelRaf(rafId);
            rafId = null;
        }
    }
    function seek(t: number) {
        currentTime = Math.min(Math.max(t, 0), duration);
        pushCurrentFrame();
        emitTime();
    }

    function onTimeUpdate(cb: (t: number) => void) {
        timeListeners.add(cb);
        return () => { timeListeners.delete(cb); };
    }
    function onEnded(cb: () => void) {
        endedListeners.add(cb);
        return () => { endedListeners.delete(cb); };
    }

    function mountControls(el: HTMLElement, options: PlayerControlsOptions = {}): void {
        unmountControls();
        controlsDispose = mountControlStrip(el, player, options);
    }
    function unmountControls(): void {
        if (controlsDispose) {
            controlsDispose();
            controlsDispose = null;
        }
    }

    if (autoplayShouldStart(init.autoplay, frameCount)) {
        play();
    } else if (frameCount > 0) {
        pushCurrentFrame();
    }

    const player: Player = {
        get playing(): boolean { return playing; },
        get duration(): number { return duration; },
        get currentTime(): number { return currentTime; },
        get frameCount(): number { return frameCount; },
        get fps(): number { return fps; },
        get speed(): number { return speed; },
        set speed(s: number) { speed = s; },
        get loop(): boolean { return loop; },
        set loop(l: boolean) { loop = l; },
        play, pause, seek,
        onTimeUpdate, onEnded,
        mountControls, unmountControls,
    };
    return player;
}

function autoplayShouldStart(autoplay: boolean, frameCount: number): boolean {
    return autoplay && frameCount > 0;
}

/**
 * Minimal control strip: play/pause button, scrubber, time readout.
 * Uses the shared `.control-bar` / `.control-row` classes from
 * `global.css` so the strip inherits the app's theme.
 */
function mountControlStrip(el: HTMLElement, player: Player, options: PlayerControlsOptions): () => void {
    const labels = options.labels ?? {};
    el.innerHTML = '';
    el.classList.add('control-bar');
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'gfx-player-play-pause-btn';

    const scrub = document.createElement('input');
    scrub.type = 'range';
    scrub.min = '0';
    scrub.max = String(Math.max(player.duration, 0.001));
    scrub.step = '0.01';
    scrub.value = String(player.currentTime);

    const readout = document.createElement('span');
    readout.className = 'slider-readout';
    readout.textContent = fmtTime(player.currentTime);

    el.append(playBtn, scrub, readout);

    const playToggle = setupToggleButton(playBtn, {
        off: { state: 'paused', label: labels.play ?? '' },
        on:  { state: 'playing', label: labels.pause ?? '' },
    }, player.playing ? 'on' : 'off', () => {
        if (player.playing) player.pause();
        else player.play();
        playToggle.setState(player.playing ? 'on' : 'off');
    });

    function refresh(t: number) {
        scrub.value = String(t);
        readout.textContent = fmtTime(t);
        playToggle.setState(player.playing ? 'on' : 'off');
    }
    const offTime = player.onTimeUpdate(refresh);
    const onScrub = () => { player.seek(parseFloat(scrub.value)); };
    scrub.addEventListener('input', onScrub);

    return function dispose() {
        offTime();
        scrub.removeEventListener('input', onScrub);
        el.classList.remove('control-bar');
        el.innerHTML = '';
    };
}

function fmtTime(t: number): string {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${String(m)}:${s.toFixed(2).padStart(5, '0')}`;
}

/**
 * Dev-only debug panel (issue #228): stats-gl FPS/GPU overlay + a lil-gui
 * live-tweak panel + an eruda on-page console, all bundled into ONE lazy
 * chunk that only loads when `?debug` is in the URL (or
 * `localStorage['lm:debug-panel']` is set) — see the gate in `main.ts`.
 *
 * Nothing in this file is imported statically by any mainline module.
 * The only coupling point into the rest of the app is `debug-hooks.ts`
 * (see that file for why it's split out).
 */

import Stats from 'stats-gl';
import GUI from 'lil-gui';
import type { WebGLRenderer } from 'three';
import { setRendererHandler } from './debug-hooks';
import './debug-panel.css';

/** A slider this panel knows how to bind, keyed by the DOM element's id. */
interface SliderBinding {
    id: string;
    label: string;
}

// moviemaker's blur radius / sigma / bloom-strength sliders (rng_diameter
// doesn't exist in moviemaker today — the screenmap's declared diameter
// drives preview dot size there — but is included so this list also works
// unchanged if/when moviemaker grows one, and so the binding is a plain
// "does the element exist" check rather than a per-tool special case).
const MOVIEMAKER_SLIDERS: SliderBinding[] = [
    { id: 'rng_blur', label: 'Blur Radius' },
    { id: 'rng_blur_sigma', label: 'Blur Sigma' },
    { id: 'rng_bloom_strength', label: 'Bloom Strength' },
    { id: 'rng_diameter', label: 'LED Diameter' },
];

let initialized = false;
let stats: Stats | null = null;
let gui: GUI | null = null;
let moviemakerFolder: GUI | null = null;
let rescanTimer: ReturnType<typeof setTimeout> | null = null;

/** Bind one existing `<input type="range">` to a lil-gui number controller.
 *  Reads min/max/step off the slider itself so the two never drift apart.
 *  On change: writes the slider's value and dispatches a real `input` event
 *  so the tool's own listener (wireSliderReadout, etc.) does the actual
 *  work — this panel never touches tool state directly. */
function bindSliderControl(folder: GUI, slider: HTMLInputElement, label: string): void {
    const min = slider.min !== '' ? Number(slider.min) : 0;
    const max = slider.max !== '' ? Number(slider.max) : 100;
    const step = (slider.step !== '' && slider.step !== 'any') ? Number(slider.step) : 1;
    const proxy = { value: Number(slider.value) };
    folder.add(proxy, 'value', min, max, step)
        .name(label)
        .onChange((value: number) => {
            slider.value = String(value);
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
}

/** Rebuild the moviemaker folder from whatever sliders currently exist in
 *  the DOM. Safe to call on every route change — destroys the previous
 *  folder first so navigating away and back never duplicates controllers. */
function rescanMoviemakerControls(): void {
    if (!gui) return;
    if (moviemakerFolder) {
        moviemakerFolder.destroy();
        moviemakerFolder = null;
    }
    const bindings = MOVIEMAKER_SLIDERS
        .map(({ id, label }) => ({ el: document.querySelector<HTMLInputElement>(`#${id}`), label }))
        .filter((b): b is { el: HTMLInputElement; label: string } => b.el !== null);
    if (bindings.length === 0) return;

    const folder = gui.addFolder('Moviemaker');
    for (const { el, label } of bindings) {
        bindSliderControl(folder, el, label);
    }
    moviemakerFolder = folder;
}

/** Debounced rescan — a tool swap touches the DOM many times in a row
 *  (innerHTML clear, then the new tool's markup mounting piece by piece);
 *  coalesce those into a single rescan. */
function scheduleRescan(): void {
    if (rescanTimer !== null) clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => {
        rescanTimer = null;
        rescanMoviemakerControls();
    }, 50);
}

/** Watch the router's mount point for tool swaps so the moviemaker folder
 *  follows navigation without any change to router.ts. */
function watchRouteChanges(): void {
    const appEl = document.getElementById('app');
    if (!appEl) return;
    const observer = new MutationObserver(scheduleRescan);
    observer.observe(appEl, { childList: true, subtree: true });
}

/** Attach the stats-gl overlay to a renderer. stats-gl patches the
 *  renderer's own render() call to time it, so this just needs to be
 *  called once per renderer instance — registerRenderer() (via
 *  debug-hooks.ts) calls it every time three-utils builds one, including
 *  across tool navigation. */
function attachStatsToRenderer(renderer: WebGLRenderer): void {
    if (!stats) return;
    stats.init(renderer).catch((err: unknown) => {
        console.error('[debug-panel] stats-gl init failed:', err);
    });
}

/** Entry point — called from main.ts behind the `?debug` / localStorage
 *  gate. Idempotent: safe to call more than once (e.g. if the gate check
 *  ever runs twice), only the first call does anything. */
export function initDebugPanel(): void {
    if (initialized) return;
    initialized = true;

    stats = new Stats({ trackGPU: true });
    stats.dom.classList.add('debug-panel-stats');
    document.body.appendChild(stats.dom);
    setRendererHandler(attachStatsToRenderer);

    function statsLoop(): void {
        stats?.update();
        requestAnimationFrame(statsLoop);
    }
    requestAnimationFrame(statsLoop);

    gui = new GUI({ title: 'Debug' });
    gui.domElement.classList.add('debug-panel-gui');
    watchRouteChanges();
    rescanMoviemakerControls(); // cover the tool that's already loaded

    import('eruda').then((erudaModule) => {
        erudaModule.default.init();
    }).catch((err: unknown) => {
        console.error('[debug-panel] eruda init failed:', err);
    });
}

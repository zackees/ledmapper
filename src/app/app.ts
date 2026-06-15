/**
 * Layered single-page app shell — Phase 6 (issue #133).
 *
 * Two modes — Play and Create — switched via a DaVinci-style bottom bar.
 * Each mode lazily mounts the existing tool's `init` function into the
 * content slot; switching modes tears down the previous tool and mounts
 * the next. Future PRs will share state + scene across modes.
 *
 * The shell routes:
 *   /play   → Play  (today, the existing demo's playback UX)
 *   /create → Create (today, the existing moviemaker pipeline)
 */

import type { SpaHistory, ToolInitFn } from '../types/domain';
import { setNavVisible } from '../nav';
import templateHtml from './template.html?raw';

export { default as css } from './app.css?url';

export type AppMode = 'play' | 'create';

interface LayerModule {
    init?: ToolInitFn;
    css?: string;
}

const layerLoaders: Record<AppMode, () => Promise<LayerModule>> = {
    play:   () => import('../demo/demo'),
    create: () => import('../moviemaker/moviemaker'),
};

const modeRoutes: Record<AppMode, string> = {
    play:   '/play',
    create: '/create',
};

const modeTitles: Record<AppMode, string> = {
    play:   'Play — LED Mapper',
    create: 'Create — LED Mapper',
};

/**
 * Tool entry point. Renders the shell, mounts the requested mode (or
 * `play` by default if the URL is `/`), and wires the bottom-bar
 * buttons + history events.
 */
export function init(container: HTMLElement, nav?: SpaHistory): () => void {
    container.innerHTML = templateHtml;
    // The shell's bottom mode bar replaces the legacy top nav — hide it
    // while the shell is mounted. Legacy per-tool routes keep their nav.
    setNavVisible(false);
    const contentElRaw = container.querySelector<HTMLElement>('#app-content');
    const modeBarElRaw = container.querySelector<HTMLElement>('#app-mode-bar');
    if (!contentElRaw || !modeBarElRaw) throw new Error('app shell template missing required elements');
    const contentEl: HTMLElement = contentElRaw;
    const modeBarEl: HTMLElement = modeBarElRaw;

    let currentMode: AppMode | null = null;
    let currentDestroy: (() => void) | null = null;
    let activationId = 0; // guards against concurrent mode switches

    /** Set the visual active state on the mode bar buttons. */
    function updateModeBar(mode: AppMode) {
        for (const btn of modeBarEl.querySelectorAll<HTMLButtonElement>('.app-mode-btn')) {
            btn.classList.toggle('is-active', btn.dataset.mode === mode);
        }
    }

    /** Mount a mode's tool module into the content slot. Tears down any prior mount. */
    async function activate(mode: AppMode) {
        if (mode === currentMode) return;
        const id = ++activationId;
        if (currentDestroy) {
            try { currentDestroy(); } catch (e) { console.warn('layer destroy threw', e); }
            currentDestroy = null;
        }
        contentEl.innerHTML = '';
        const module = await layerLoaders[mode]();
        if (id !== activationId) return; // a later activation overtook us
        currentMode = mode;
        updateModeBar(mode);
        document.title = modeTitles[mode];
        if (module.init) {
            const destroyer = module.init(contentEl, nav);
            currentDestroy = destroyer ?? null;
        }
    }

    // Bottom-bar click → activate that mode and update the URL via the
    // SPA history so deep links + back/forward keep working.
    modeBarEl.addEventListener('click', (e) => {
        const target = e.target as Element | null;
        const btn = target?.closest<HTMLButtonElement>('.app-mode-btn');
        if (!btn) return;
        const mode = btn.dataset.mode as AppMode | undefined;
        if (!mode || !(mode in layerLoaders)) return;
        const path = modeRoutes[mode];
        if (nav) nav.navigate(path);
        else void activate(mode); // standalone mount (no router)
    });

    // Initial activation derived from the current URL.
    const initialMode: AppMode = window.location.pathname.startsWith('/create') ? 'create' : 'play';
    void activate(initialMode);

    return function destroy() {
        if (currentDestroy) {
            try { currentDestroy(); } catch (e) { console.warn('layer destroy threw', e); }
            currentDestroy = null;
        }
        currentMode = null;
        contentEl.innerHTML = '';
        setNavVisible(true);
    };
}

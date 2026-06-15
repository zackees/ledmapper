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

/**
 * Per-mode `data-tool` value matched by the underlying tool's CSS
 * (every per-tool stylesheet gates its rules on `[data-tool="<name>"]`).
 * When the shell hosts a tool, the content slot needs to carry that
 * tool's name or none of the tool's CSS applies — see issue #133
 * + the broken /create snapshot that motivated this fix.
 */
const modeToolNames: Record<AppMode, string> = {
    play:   'demo',
    create: 'moviemaker',
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
        // Stamp the content slot with the hosted tool's data-tool name so
        // the tool's CSS (gated on `[data-tool="<name>"]`) applies. The
        // router writes `data-tool="app"` on the outer #app; we override
        // on the inner slot for the active layer.
        contentEl.dataset.tool = modeToolNames[mode];
        const module = await layerLoaders[mode]();
        if (id !== activationId) return; // a later activation overtook us
        // Swap in the layer's per-tool CSS. The router's #tool-css link
        // is pointing at app.css for the shell; the layer's own
        // stylesheet rides on a second #layer-css link.
        if (module.css) {
            const linkEl = document.getElementById('layer-css') as HTMLLinkElement | null;
            if (linkEl && linkEl.getAttribute('href') !== module.css) {
                const cssLink = linkEl;
                await new Promise<void>((resolve) => {
                    cssLink.onload = () => { resolve(); };
                    cssLink.onerror = () => { resolve(); };
                    cssLink.href = module.css ?? '';
                });
                if (id !== activationId) return;
            }
        }
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

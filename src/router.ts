import { updateActiveLink } from './nav';
import type { SpaHistory, ToolInitFn } from './types/domain';

const routes = [
    { path: '/',                  tool: 'app' },
    { path: '/index.html',       tool: 'app' },
    { path: '/play',             tool: 'app' },
    { path: '/play/',            tool: 'app' },
    { path: '/create',           tool: 'app' },
    { path: '/create/',          tool: 'app' },
    { path: '/record',           tool: 'app' },
    { path: '/record/',          tool: 'app' },
    { path: '/hub',              tool: 'hub' },
    { path: '/hub/',             tool: 'hub' },
    { path: '/demo/',            tool: 'demo' },
    { path: '/demo/index.html',  tool: 'demo' },
    { path: '/moviemaker/',            tool: 'moviemaker' },
    { path: '/moviemaker/index.html',  tool: 'moviemaker' },
    { path: '/movieplayer/',            tool: 'movieplayer' },
    { path: '/movieplayer/index.html',  tool: 'movieplayer' },
    { path: '/shapeeditor/',            tool: 'shapeeditor' },
    { path: '/shapeeditor/index.html',  tool: 'shapeeditor' },
    { path: '/screenmap/',              tool: 'screenmap' },
    { path: '/screenmap/index.html',    tool: 'screenmap' },
];

interface ToolModule {
    css?: string;
    init?: ToolInitFn;
}

const toolConfig: Record<string, { module: () => Promise<ToolModule> }> = {
    app: {
        module: () => import('./app/app'),
    },
    hub: {
        module: () => import('./hub/hub'),
    },
    demo: {
        module: () => import('./demo/demo'),
    },
    moviemaker: {
        module: () => import('./moviemaker/moviemaker'),
    },
    movieplayer: {
        module: () => import('./movieplayer/movieplayer'),
    },
    shapeeditor: {
        module: () => import('./shapeeditor/shapeeditor'),
    },
    screenmap: {
        module: () => import('./screenmap/screenmap'),
    },
};

const titles: Record<string, string> = {
    app: 'LED Mapper',
    hub: 'FastLED Video Mapper',
    demo: 'Demo',
    moviemaker: 'Video Maker',
    movieplayer: 'Video Player',
    shapeeditor: 'ScreenMap Design',
    screenmap: 'Screenmap Maker',
};

// State stored on each history entry. `p` is the resolved route path so a
// popstate can tell a tool change (path differs) from an in-tool view change
// (same path, different `v`). `v`/`d` carry an optional in-tool view + payload.
interface HistoryState {
    p: string;
    v?: string;
    d?: unknown;
}

/** Resolve a path to its tool, or null when the path is not a known route. */
function resolveTool(path: string): string | null {
    const route = routes.find(r => r.path === path);
    if (route) return route.tool;
    // Tolerate a missing/extra trailing slash.
    const withSlash = path.endsWith('/') ? path : path + '/';
    const withoutSlash = path.endsWith('/') ? path.slice(0, -1) : path;
    const fallback = routes.find(r => r.path === withSlash || r.path === withoutSlash);
    return fallback?.tool ?? null;
}

export function createRouter(appEl: HTMLElement) {
    let currentDestroy: (() => void) | null = null;
    let loadId = 0; // guard against concurrent loads
    let currentPath = window.location.pathname;
    let popViewHandler: ((view: string | null, data: unknown) => void) | null = null;
    const toolCssLink = document.getElementById('tool-css') as HTMLLinkElement | null;

    // We restore scroll explicitly (top on tool change) rather than letting the
    // browser guess against content that is injected asynchronously.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

    async function loadRoute(path: string) {
        const tool = resolveTool(path) ?? 'hub';
        const thisLoad = ++loadId; // capture current load id

        // Switching tools: drop the previous tool's in-tool pop handler so a
        // later Back doesn't fire a stale callback.
        popViewHandler = null;

        // Tear down current tool
        if (currentDestroy) {
            try { currentDestroy(); } catch (e) { console.error('destroy error:', e); }
            currentDestroy = null;
        }

        // Clear app container and hide it until content + CSS are ready
        appEl.innerHTML = '';
        appEl.dataset.tool = tool;
        appEl.style.animation = 'none';
        appEl.style.opacity = '0';

        // Update nav active state
        updateActiveLink(path);

        // Update page title
        document.title = titles[tool] ?? 'FastLED Video Mapper';

        // Load and initialize tool module
        const config = toolConfig[tool];
        if (!config) {
            console.error(`No config for tool: ${tool}`);
            return;
        }
        try {
            const mod = await config.module();

            // Abort if a newer navigation started while we were loading
            if (thisLoad !== loadId) return;

            // Wait for tool CSS to load before injecting content
            if (mod.css) {
                if (toolCssLink) {
                    const currentHref = toolCssLink.getAttribute('href');
                    if (currentHref !== mod.css) {
                        // toolCssLink is non-null here (outer if-guard)
                        const cssLink = toolCssLink;
                        await new Promise<void>((resolve) => {
                            cssLink.onload = () => { resolve(); };
                            cssLink.onerror = () => { resolve(); };
                            cssLink.href = mod.css ?? '';
                        });
                    }
                }
            } else {
                toolCssLink?.removeAttribute('href');
            }

            if (thisLoad !== loadId) return;

            if (mod.init) {
                const destroy = mod.init(appEl, spaHistory);
                if (typeof destroy === 'function') {
                    currentDestroy = destroy;
                }
            }

            // Land at the top of the freshly loaded tool.
            window.scrollTo(0, 0);

            // Content and CSS are ready — trigger entrance animation
            appEl.style.opacity = '';
            appEl.style.animation = '';
            void appEl.offsetHeight; // force reflow
            appEl.style.animation = 'lm-page-enter 300ms var(--lm-ease) both';
        } catch (e: unknown) {
            if (thisLoad !== loadId) return;
            console.error(`Failed to load tool "${tool}":`, e);
            appEl.style.opacity = '';
            appEl.style.animation = '';
            appEl.innerHTML = `<div style="color:red;padding:20px;">Failed to load tool: ${e instanceof Error ? e.message : String(e)}</div>`;
        }
    }

    function navigate(path: string) {
        // Normalize to a canonical absolute pathname so relative hrefs and any
        // /index.html suffix collapse to the route path used for comparison.
        const url = new URL(path, window.location.origin);
        const target = url.pathname;
        if (target === currentPath) return;
        history.pushState({ p: target } satisfies HistoryState, '', target + url.search + url.hash);
        currentPath = target;
        void loadRoute(target);
    }

    function pushView(view: string, data?: unknown) {
        // Same URL, new history entry — Back returns to the prior in-tool view.
        history.pushState({ p: currentPath, v: view, d: data } satisfies HistoryState, '', window.location.href);
    }

    function replaceView(view: string, data?: unknown) {
        history.replaceState({ p: currentPath, v: view, d: data } satisfies HistoryState, '', window.location.href);
    }

    function onPopView(handler: (view: string | null, data: unknown) => void): () => void {
        popViewHandler = handler;
        return () => { if (popViewHandler === handler) popViewHandler = null; };
    }

    const spaHistory: SpaHistory = {
        navigate,
        pushView,
        replaceView,
        back: () => { history.back(); },
        onPopView,
    };

    // Handle back/forward buttons.
    window.addEventListener('popstate', (e) => {
        const path = window.location.pathname;
        const state = e.state as HistoryState | null;
        if (path !== currentPath) {
            // Crossed a tool boundary — load the tool for the new path.
            currentPath = path;
            void loadRoute(path);
        } else if (popViewHandler) {
            // Same route — an in-tool view boundary was crossed. Let the tool
            // react (e.g. close a panel) without reloading.
            popViewHandler(state?.v ?? null, state?.d ?? null);
        }
    });

    // Intercept internal link clicks (delegated). Only genuine left-clicks on
    // same-origin links that resolve to a known route are handled in-app;
    // everything else (modifier-clicks, downloads, new-tab targets, external or
    // unknown paths) falls through to the browser's default behavior.
    document.addEventListener('click', (e) => {
        if (e.defaultPrevented) return;
        // Let the browser handle modifier-clicks (open in new tab/window) and
        // non-primary mouse buttons.
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        const a = (e.target as Element | null)?.closest('a');
        if (!a) return;

        const linkTarget = a.getAttribute('target');
        if (linkTarget && linkTarget !== '_self') return;
        if (a.hasAttribute('download')) return;

        const href = a.getAttribute('href');
        if (!href) return;
        if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('blob:')) return;

        // Use the anchor's resolved properties so relative hrefs and
        // cross-origin links are classified correctly.
        if (a.origin !== window.location.origin) return;
        if (resolveTool(a.pathname) === null) return; // unknown internal path — let the browser load it

        e.preventDefault();
        navigate(a.pathname + a.search + a.hash);
    });

    // Expose for callers without a tool reference (and for integration/tests).
    window.spaHistory = spaHistory;

    return {
        ...spaHistory,
        start() {
            currentPath = window.location.pathname;
            // Seed the initial entry with state so the first Back/Forward has a
            // well-formed state object to read.
            history.replaceState(
                { p: currentPath } satisfies HistoryState,
                '',
                currentPath + window.location.search + window.location.hash,
            );
            void loadRoute(currentPath);
        },
    };
}

import { updateActiveLink, setNavVisible } from './nav';
import type { SpaHistory, ToolInitFn } from './types/domain';
import { createLogger } from './debug-log';

const log = createLogger('router');

const routes = [
    { path: '/',                  tool: 'app' },
    { path: '/index.html',       tool: 'app' },
    { path: '/play',             tool: 'app' },
    { path: '/play/',            tool: 'app' },
    { path: '/create',           tool: 'app' },
    { path: '/create/',          tool: 'app' },
    { path: '/record',           tool: 'app' },
    { path: '/record/',          tool: 'app' },
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
    demo: 'Demo',
    moviemaker: 'Video Maker',
    movieplayer: 'Play',
    shapeeditor: 'ScreenMap Design',
    screenmap: 'Create',
};

const legacyRedirects: Record<string, string> = {
    '/hub': '/play',
    '/hub/': '/play',
};

function canonicalPath(path: string): string {
    return legacyRedirects[path] ?? path;
}

function setRouteLoading(appEl: HTMLElement): void {
    appEl.classList.add('is-route-loading');
    appEl.classList.remove('is-route-entering');
}

function setRouteReady(appEl: HTMLElement): void {
    appEl.classList.remove('is-route-loading', 'is-route-entering');
    void appEl.offsetHeight; // force reflow before replaying the entry animation
    appEl.classList.add('is-route-entering');
}

function renderRouteError(appEl: HTMLElement, message: string): void {
    const errorEl = document.createElement('div');
    errorEl.className = 'route-load-error';
    errorEl.textContent = `Failed to load tool: ${message}`;
    appEl.replaceChildren(errorEl);
}

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
    let routePathHandler: ((path: string) => void) | null = null;
    let navigationGuard: ((nextPath: string) => boolean) | null = null;
    let currentLocation = window.location.pathname + window.location.search + window.location.hash;
    const toolCssLink = document.getElementById('tool-css') as HTMLLinkElement | null;

    // We restore scroll explicitly (top on tool change) rather than letting the
    // browser guess against content that is injected asynchronously.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

    async function loadRoute(path: string) {
        const canonical = canonicalPath(path);
        if (canonical !== path) {
            history.replaceState({ p: canonical } satisfies HistoryState, '', canonical + window.location.search + window.location.hash);
            path = canonical;
        }
        const tool = resolveTool(path) ?? 'app';
        log.info('navigate', { path });
        const thisLoad = ++loadId; // capture current load id

        // Switching tools: drop the previous tool's in-tool pop handler so a
        // later Back doesn't fire a stale callback.
        popViewHandler = null;
        routePathHandler = null;

        // Tear down current tool
        if (currentDestroy) {
            try { currentDestroy(); } catch (e) { log.error('destroy-error', { error: e instanceof Error ? e.message : String(e) }); }
            currentDestroy = null;
        }

        // Clear app container and hide it until content + CSS are ready
        appEl.innerHTML = '';
        appEl.dataset.tool = tool;
        setRouteLoading(appEl);

        // Update nav active state. Also drive the legacy top nav's visibility
        // here, synchronously, before the first paint of the new route: the
        // app shell (#133) replaces the top nav with its own bottom mode bar,
        // so on a shell route the nav must never paint. Doing this in the
        // router (rather than only inside the async app module's init) closes
        // the ~400ms window where the top nav flashed on a cold load of "/"
        // before app/app.ts finished importing (issue #284).
        updateActiveLink(path);
        setNavVisible(tool !== 'app');

        // Update page title
        document.title = titles[tool] ?? 'FastLED Video Mapper';

        // Load and initialize tool module
        const config = toolConfig[tool];
        if (!config) {
            log.error('no-config', { tool });
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
            setRouteReady(appEl);
        } catch (e: unknown) {
            if (thisLoad !== loadId) return;
            log.error('load-failed', { tool, error: e instanceof Error ? e.message : String(e) });
            setRouteReady(appEl);
            renderRouteError(appEl, e instanceof Error ? e.message : String(e));
        }
    }

    function navigate(path: string) {
        // Normalize to a canonical absolute pathname so relative hrefs and any
        // /index.html suffix collapse to the route path used for comparison.
        const url = new URL(path, window.location.origin);
        const target = canonicalPath(url.pathname);
        if (target === currentPath) return;
        if (!navigationAllowed(target)) return;
        history.pushState({ p: target } satisfies HistoryState, '', target + url.search + url.hash);
        currentLocation = target + url.search + url.hash;
        const staysInCurrentTool = routePathHandler !== null
            && resolveTool(target) !== null
            && resolveTool(target) === resolveTool(currentPath);
        currentPath = target;
        if (staysInCurrentTool && routePathHandler) {
            log.info('navigate', { path: target, shellPreserved: true });
            updateActiveLink(target);
            routePathHandler(target);
            return;
        }
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

    function onRoutePath(handler: (path: string) => void): () => void {
        routePathHandler = handler;
        return () => { if (routePathHandler === handler) routePathHandler = null; };
    }

    function navigationAllowed(nextPath: string): boolean {
        if (!navigationGuard) return true;
        try {
            const allowed = navigationGuard(nextPath);
            if (!allowed) log.info('navigation-blocked', { from: currentPath, to: nextPath });
            return allowed;
        } catch (error) {
            log.error('navigation-guard-error', { error: error instanceof Error ? error.message : String(error) });
            return false;
        }
    }

    function blockNavigation(handler: (nextPath: string) => boolean): () => void {
        navigationGuard = handler;
        return () => { if (navigationGuard === handler) navigationGuard = null; };
    }

    const spaHistory: SpaHistory = {
        navigate,
        pushView,
        replaceView,
        back: () => { history.back(); },
        onPopView,
        onRoutePath,
        blockNavigation,
    };

    // Handle back/forward buttons.
    window.addEventListener('popstate', (e) => {
        const path = window.location.pathname;
        const canonical = canonicalPath(path);
        if (canonical !== path) {
            history.replaceState({ p: canonical } satisfies HistoryState, '', canonical + window.location.search + window.location.hash);
        }
        const state = e.state as HistoryState | null;
        if (canonical !== currentPath) {
            if (!navigationAllowed(canonical)) {
                history.pushState({ p: currentPath } satisfies HistoryState, '', currentLocation);
                return;
            }
            const staysInCurrentTool = routePathHandler !== null
                && resolveTool(path) !== null
                && resolveTool(path) === resolveTool(currentPath);
            currentPath = canonical;
            currentLocation = canonical + window.location.search + window.location.hash;
            if (staysInCurrentTool && routePathHandler) {
                log.info('navigate', { path: canonical, shellPreserved: true, history: 'pop' });
                updateActiveLink(canonical);
                routePathHandler(canonical);
            } else {
                // Crossed a tool boundary — load the tool for the new path.
                void loadRoute(canonical);
            }
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
            currentPath = canonicalPath(window.location.pathname);
            currentLocation = currentPath + window.location.search + window.location.hash;
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

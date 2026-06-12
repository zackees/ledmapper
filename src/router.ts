import { updateActiveLink } from './nav';

const routes = [
    { path: '/',                  tool: 'hub' },
    { path: '/index.html',       tool: 'hub' },
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

const toolConfig = {
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

export function createRouter(appEl: HTMLElement) {
    let currentDestroy: (() => void) | null = null;
    let loadId = 0; // guard against concurrent loads
    const toolCssLink = document.getElementById('tool-css') as HTMLLinkElement | null;

    function matchRoute(path: string): string {
        const route = routes.find(r => r.path === path);
        if (route) return route.tool;
        // Try stripping trailing slash or adding it
        const withSlash = path.endsWith('/') ? path : path + '/';
        const withoutSlash = path.endsWith('/') ? path.slice(0, -1) : path;
        const fallback = routes.find(r => r.path === withSlash || r.path === withoutSlash);
        return fallback ? fallback.tool : 'hub';
    }

    async function loadRoute(path: string) {
        const tool = matchRoute(path);
        const thisLoad = ++loadId; // capture current load id

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
        const titles = {
            hub: 'FastLED Video Mapper',
            demo: 'Demo',
            moviemaker: 'Video Maker',
            movieplayer: 'Video Player',
            shapeeditor: 'ScreenMap Design',
            screenmap: 'Screenmap Maker',
        };
        document.title = (titles as Record<string, string>)[tool] || 'FastLED Video Mapper';

        // Load and initialize tool module
        const config = (toolConfig as Record<string, { module: () => Promise<{ css?: string; init?: (el: HTMLElement) => (() => void) | void } > }>)[tool]!;
        try {
            const mod = await config.module();

            // Abort if a newer navigation started while we were loading
            if (thisLoad !== loadId) return;

            // Wait for tool CSS to load before injecting content
            if (mod.css) {
                const currentHref = toolCssLink!.getAttribute('href');
                if (currentHref !== mod.css) {
                    await new Promise((resolve) => {
                        toolCssLink!.onload = () => resolve(undefined);
                        toolCssLink!.onerror = () => resolve(undefined);
                        toolCssLink!.href = mod.css!;
                    });
                }
            } else {
                toolCssLink!.removeAttribute('href');
            }

            if (thisLoad !== loadId) return;

            if (mod.init) {
                const destroy = mod.init(appEl);
                if (typeof destroy === 'function') {
                    currentDestroy = destroy;
                }
            }

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
            appEl.innerHTML = `<div style="color:red;padding:20px;">Failed to load tool: ${(e instanceof Error ? e.message : String(e))}</div>`;
        }
    }

    function navigate(path: string) {
        if (path === window.location.pathname) return;
        history.pushState(null, '', path);
        loadRoute(path);
    }

    // Handle back/forward buttons
    window.addEventListener('popstate', () => {
        loadRoute(window.location.pathname);
    });

    // Intercept all internal link clicks (delegated)
    document.addEventListener('click', (e) => {
        const a = (e.target as Element | null)?.closest('a');
        if (!a) return;
        const href = a.getAttribute('href');
        if (!href) return;
        // Skip external links, blob URLs, anchors, and special protocols
        if (href.startsWith('http') || href.startsWith('blob:') || href.startsWith('#') || href.startsWith('mailto:')) return;
        // Skip links with target or download attribute
        if (a.hasAttribute('target') || a.hasAttribute('download')) return;
        // Check if it's an internal route
        const tool = matchRoute(href);
        if (tool) {
            e.preventDefault();
            navigate(href);
        }
    });

    return {
        navigate,
        start() {
            loadRoute(window.location.pathname);
        }
    };
}

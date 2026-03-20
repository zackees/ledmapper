import { updateActiveLink } from './nav.js';

const routes = [
    { path: '/',                  tool: 'hub' },
    { path: '/index.html',       tool: 'hub' },
    { path: '/demo/',            tool: 'demo' },
    { path: '/demo/index.html',  tool: 'demo' },
    { path: '/screenmap/',            tool: 'screenmap' },
    { path: '/screenmap/index.html',  tool: 'screenmap' },
    { path: '/moviemaker/',            tool: 'moviemaker' },
    { path: '/moviemaker/index.html',  tool: 'moviemaker' },
    { path: '/movieplayer/',            tool: 'movieplayer' },
    { path: '/movieplayer/index.html',  tool: 'movieplayer' },
    { path: '/shapeviewer/',            tool: 'shapeviewer' },
    { path: '/shapeviewer/index.html',  tool: 'shapeviewer' },
];

const toolConfig = {
    hub: {
        css: null,
        module: () => import('./hub/hub.js'),
    },
    demo: {
        css: '/demo/demo.css',
        module: () => import('./demo/sketch.js'),
    },
    screenmap: {
        css: '/screenmap/screenmap.css',
        module: () => import('./screenmap/sketch.js'),
    },
    moviemaker: {
        css: '/moviemaker/moviemaker.css',
        module: () => import('./moviemaker/sketch.js'),
    },
    movieplayer: {
        css: '/movieplayer/movieplayer.css',
        module: () => import('./movieplayer/sketch.js'),
    },
    shapeviewer: {
        css: '/shapeviewer/shapeviewer.css',
        module: () => import('./shapeviewer/sketch.js'),
    },
};

export function createRouter(appEl) {
    let currentDestroy = null;
    const toolCssLink = document.getElementById('tool-css');

    function matchRoute(path) {
        const route = routes.find(r => r.path === path);
        if (route) return route.tool;
        // Try stripping trailing slash or adding it
        const withSlash = path.endsWith('/') ? path : path + '/';
        const withoutSlash = path.endsWith('/') ? path.slice(0, -1) : path;
        const fallback = routes.find(r => r.path === withSlash || r.path === withoutSlash);
        return fallback ? fallback.tool : 'hub';
    }

    async function loadRoute(path) {
        const tool = matchRoute(path);

        // Tear down current tool
        if (currentDestroy) {
            try { currentDestroy(); } catch (e) { console.error('destroy error:', e); }
            currentDestroy = null;
        }

        // Clear app container
        appEl.innerHTML = '';
        appEl.dataset.tool = tool;

        // Swap tool CSS
        const config = toolConfig[tool];
        if (config.css) {
            toolCssLink.href = config.css;
        } else {
            toolCssLink.removeAttribute('href');
        }

        // Update nav active state
        updateActiveLink(path);

        // Update page title
        const titles = {
            hub: 'FastLED Video Mapper',
            demo: 'Demo',
            screenmap: 'Screenmap Maker',
            moviemaker: 'Mapped Video Maker',
            movieplayer: 'Movie Player',
            shapeviewer: 'Screenmap Viewer',
        };
        document.title = titles[tool] || 'FastLED Video Mapper';

        // Load and initialize tool module
        try {
            const mod = await config.module();
            if (mod.init) {
                const destroy = mod.init(appEl);
                if (typeof destroy === 'function') {
                    currentDestroy = destroy;
                }
            }
        } catch (e) {
            console.error(`Failed to load tool "${tool}":`, e);
            appEl.innerHTML = `<div style="color:red;padding:20px;">Failed to load tool: ${e.message}</div>`;
        }
    }

    function navigate(path) {
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
        const a = e.target.closest('a');
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

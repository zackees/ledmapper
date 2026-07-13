// The product has three user-facing modes. Legacy standalone routes remain
// available for old bookmarks, but are intentionally absent from product
// navigation (#384).
const tools = [
    { name: 'Play', href: '/play' },
    { name: 'Create', href: '/create' },
    { name: 'Record', href: '/record' },
];

let navEl: HTMLElement | null = null;

export function initNav() {
    if (navEl) {
        updateActiveLink(window.location.pathname);
        return;
    }

    const nav = document.createElement('nav');
    nav.className = 'nav-bar';

    const brand = document.createElement('a');
    brand.className = 'nav-brand';
    brand.href = '/play';
    brand.textContent = 'FastLED Video Mapper';
    nav.appendChild(brand);

    const ul = document.createElement('ul');
    ul.className = 'nav-links';

    tools.forEach(tool => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = tool.href;
        a.textContent = tool.name;
        li.appendChild(a);
        ul.appendChild(li);
    });

    nav.appendChild(ul);
    document.body.prepend(nav);
    navEl = nav;

    updateActiveLink(window.location.pathname);
    // Link clicks are handled by the router's delegated document click handler,
    // so no per-nav listener is needed here.
}

export function updateActiveLink(path: string) {
    if (!navEl) return;
    const canonicalPath = path.startsWith('/demo') || path.startsWith('/movieplayer')
        ? '/play'
        : path.startsWith('/shapeeditor') || path.startsWith('/screenmap')
            ? '/create'
            : path.startsWith('/moviemaker')
                ? '/record'
                : path;
    navEl.querySelectorAll('.nav-links a').forEach(a => {
        const href = a.getAttribute('href');
        const toolDir = href === '/' ? null : (href ?? '').split('/').find(Boolean);
        if (toolDir && canonicalPath.startsWith(`/${toolDir}`)) {
            a.classList.add('active');
        } else if (!toolDir && (canonicalPath === '/' || canonicalPath === '/index.html')) {
            a.classList.add('active');
        } else {
            a.classList.remove('active');
        }
    });
}

/**
 * Show / hide the top nav. The layered app shell (#133) replaces it with
 * a bottom mode bar, so the shell calls `setNavVisible(false)` on activation
 * and `setNavVisible(true)` on tear-down. Legacy per-tool routes still
 * have the top nav for now.
 */
export function setNavVisible(visible: boolean) {
    if (!navEl) return;
    navEl.style.display = visible ? '' : 'none';
}

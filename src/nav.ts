// Labels mirror the app-shell's Play / Create / Record vocabulary (#133) so
// the product speaks one language everywhere: the shell's bottom mode bar, the
// hub cards, and this legacy top nav all name the same tools identically
// (issue #286). The hrefs stay on the standalone tool routes — many deep links
// and integration tests target them directly — but the words a user reads no
// longer flip between "Demo/Video Maker" here and "Play/Record" in the shell.
const tools = [
    { name: 'Hub', href: '/hub/' },
    { name: 'Play', href: '/demo/' },
    { name: 'Create', href: '/shapeeditor/' },
    { name: 'Record', href: '/moviemaker/' },
    { name: 'Screenmap Maker', href: '/screenmap/' },
    { name: 'Video Player', href: '/movieplayer/' },
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
    brand.href = '/hub/';
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
    navEl.querySelectorAll('.nav-links a').forEach(a => {
        const href = a.getAttribute('href');
        const toolDir = href === '/' ? null : (href ?? '').split('/').find(Boolean);
        if (toolDir && path.includes(toolDir)) {
            a.classList.add('active');
        } else if (!toolDir && (path === '/' || path === '/index.html')) {
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

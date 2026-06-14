const tools = [
    { name: 'Demo', href: '/demo/' },
    { name: 'ScreenMap Design', href: '/shapeeditor/' },
    { name: 'Video Maker', href: '/moviemaker/' },
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
    brand.href = '/';
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

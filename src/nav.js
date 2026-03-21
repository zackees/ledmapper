const tools = [
    { name: 'Demo', href: '/demo/' },
    { name: 'Screenmap Maker', href: '/screenmap/' },
    { name: 'Video Maker', href: '/moviemaker/' },
    { name: 'Video Player', href: '/movieplayer/' },
    { name: 'Shape Editor', href: '/shapeeditor/' },
];

let navEl = null;

export function initNav(onNavigate) {
    if (navEl) {
        // Nav already exists, just re-attach navigate handler
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

    // Intercept clicks on nav links for SPA navigation
    nav.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (!a) return;
        const href = a.getAttribute('href');
        if (!href || href.startsWith('http')) return;
        e.preventDefault();
        if (onNavigate) onNavigate(href);
    });
}

export function updateActiveLink(path) {
    if (!navEl) return;
    navEl.querySelectorAll('.nav-links a').forEach(a => {
        const href = a.getAttribute('href');
        const toolDir = href === '/' ? null : href.split('/').filter(Boolean)[0];
        if (toolDir && path.includes(toolDir)) {
            a.classList.add('active');
        } else if (!toolDir && (path === '/' || path === '/index.html')) {
            a.classList.add('active');
        } else {
            a.classList.remove('active');
        }
    });
}

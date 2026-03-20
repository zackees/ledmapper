const tools = [
    { name: 'Demo', href: '/demo/index.html' },
    { name: 'Screenmap Maker', href: '/screenmap/index.html' },
    { name: 'Video Maker', href: '/moviemaker/index.html' },
    { name: 'Video Player', href: '/movieplayer/index.html' },
    { name: 'Shape Viewer', href: '/shapeviewer/index.html' },
];

export function initNav() {
    const nav = document.createElement('nav');
    nav.className = 'nav-bar';

    const brand = document.createElement('a');
    brand.className = 'nav-brand';
    brand.href = '/hub/index.html';
    brand.textContent = 'FastLED Video Mapper';
    nav.appendChild(brand);

    const ul = document.createElement('ul');
    ul.className = 'nav-links';

    const currentPath = window.location.pathname;

    tools.forEach(tool => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = tool.href;
        a.textContent = tool.name;
        if (currentPath.includes(tool.href.split('/')[1])) {
            a.classList.add('active');
        }
        li.appendChild(a);
        ul.appendChild(li);
    });

    nav.appendChild(ul);
    document.body.prepend(nav);
}

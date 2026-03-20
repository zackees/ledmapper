import templateHtml from './template.html?raw';

export function init(container) {
    container.innerHTML = templateHtml;
    return function destroy() {};
}

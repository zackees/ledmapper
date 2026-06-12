import templateHtml from './template.html?raw';
export { default as css } from './hub.css?url';

export function init(container: HTMLElement) {
    container.innerHTML = templateHtml;
    return undefined;
}

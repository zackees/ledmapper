import templateHtml from './template.html?raw';
export { default as css } from './hub.css?url';

export function init(container: any) {
    container.innerHTML = templateHtml;
    return function destroy() {};
}

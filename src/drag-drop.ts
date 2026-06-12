/**
 * Shared drag-and-drop file upload helpers.
 */

/**
 * Wire a DOM element as a drop target for file uploads.
 * Adds a `.drag-over` affordance class while a file is dragged over the
 * target and routes the dropped file through the same handler as the
 * file picker.
 *
 * @param {object} options
 * @param {Element} options.target - element that accepts drops
 * @param {HTMLInputElement} [options.input] - associated file input; drops
 *   are ignored while it is disabled
 * @param {(file: File|undefined) => void} options.onFile - receives the
 *   dropped file (validation is the handler's responsibility)
 * @param {AbortSignal} [options.signal] - removes the listeners on abort
 */
export function wireFileDropTarget({ target, input = null as HTMLInputElement | null, onFile, signal }: { target: Element; input?: HTMLInputElement | null; onFile: (file: File | undefined) => void; signal?: AbortSignal }) {
    const isDisabled = () => Boolean(input && (input as HTMLInputElement).disabled);

    target.addEventListener('dragover', (event: Event) => {
        event.preventDefault();
        const dragEvent = event as DragEvent;
        if (dragEvent.dataTransfer) {
            dragEvent.dataTransfer.dropEffect = isDisabled() ? 'none' : 'copy';
        }
        if (!isDisabled()) {
            target.classList.add('drag-over');
        }
    }, { signal });

    target.addEventListener('dragleave', () => {
        target.classList.remove('drag-over');
    }, { signal });

    target.addEventListener('drop', (event: Event) => {
        event.preventDefault();
        target.classList.remove('drag-over');
        if (isDisabled()) return;
        const dragEvent = event as DragEvent;
        const file = dragEvent.dataTransfer?.files?.[0];
        onFile(file);
    }, { signal });
}

/**
 * Check whether a file's name ends with one of the given extensions.
 *
 * @param {File} file
 * @param {string[]} extensions - lowercase, including the dot (e.g. '.json')
 * @returns {boolean}
 */
export function fileHasExtension(file: File, extensions: string[]): boolean {
    const name = file.name.toLowerCase();
    return extensions.some((extension: string) => name.endsWith(extension));
}

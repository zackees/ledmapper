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
export function wireFileDropTarget({ target, input = null, onFile, signal }) {
    const isDisabled = () => Boolean(input && input.disabled);

    target.addEventListener('dragover', (event) => {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = isDisabled() ? 'none' : 'copy';
        }
        if (!isDisabled()) {
            target.classList.add('drag-over');
        }
    }, { signal });

    target.addEventListener('dragleave', () => {
        target.classList.remove('drag-over');
    }, { signal });

    target.addEventListener('drop', (event) => {
        event.preventDefault();
        target.classList.remove('drag-over');
        if (isDisabled()) return;
        const file = event.dataTransfer?.files?.[0];
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
export function fileHasExtension(file, extensions) {
    const name = file.name.toLowerCase();
    return extensions.some((extension) => name.endsWith(extension));
}

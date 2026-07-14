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
    const isDisabled = () => Boolean(input?.disabled);
    const opts: AddEventListenerOptions = signal !== undefined ? { signal } : {};

    target.addEventListener('dragover', (event: Event) => {
        event.preventDefault();
        const dragEvent = event as DragEvent;
        if (dragEvent.dataTransfer) {
            dragEvent.dataTransfer.dropEffect = isDisabled() ? 'none' : 'copy';
        }
        if (!isDisabled()) {
            target.classList.add('drag-over');
        }
    }, opts);

    target.addEventListener('dragleave', () => {
        target.classList.remove('drag-over');
    }, opts);

    target.addEventListener('drop', (event: Event) => {
        event.preventDefault();
        target.classList.remove('drag-over');
        if (isDisabled()) return;
        const dragEvent = event as DragEvent;
        const file = dragEvent.dataTransfer?.files[0];
        onFile(file);
    }, opts);
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

/** Open a file input after clearing its current selection. */
export function resetAndOpenFilePicker(input: HTMLInputElement): void {
    input.value = '';
    input.click();
}

/**
 * Wire an `<input type="file">` so each user-picked file is forwarded to
 * `onFile`. Replaces the repeated three-liner:
 *
 *   input.addEventListener('change', () => {
 *       onFile(input.files?.[0]);
 *   }, { signal });
 */
export function wireFilePicker(
    { input, onFile, signal }: {
        input: HTMLInputElement;
        onFile: (file: File | undefined) => void;
        signal?: AbortSignal;
    },
): void {
    const opts: AddEventListenerOptions = signal !== undefined ? { signal } : {};
    input.addEventListener('change', () => {
        onFile(input.files?.[0]);
    }, opts);
}

/**
 * Wire a file `<input>` AND a drop-target DOM element so that both the
 * click-to-browse path and the drag-and-drop path route through the same
 * `onFile` handler. Convenience for the very common "upload row" pattern.
 *
 * The drop target's `dropEffect` is gated on the input's `disabled`
 * state so disabling the picker visually + functionally disables drops.
 */
export function wireFileSource(
    { input, target, onFile, signal }: {
        input: HTMLInputElement;
        target: Element;
        onFile: (file: File | undefined) => void;
        signal?: AbortSignal;
    },
): void {
    const pickerBase = { input, onFile };
    const dropBase = { target, input, onFile };
    wireFilePicker(signal !== undefined ? { ...pickerBase, signal } : pickerBase);
    wireFileDropTarget(signal !== undefined ? { ...dropBase, signal } : dropBase);
}

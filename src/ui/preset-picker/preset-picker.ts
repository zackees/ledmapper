/**
 * Shared categorized-accordion preset picker.
 *
 * One picker module used by Record (moviemaker, `mode: 'compact'`) and
 * Create (shapeeditor, `mode: 'inline'`) so the preset list — currently
 * 13 entries and growing — is collated into a small number of
 * collapsible categories rather than a flat wrap-row that overflows
 * the sidebar.
 *
 * Issue #206.
 */

import bakedManifest, {
    type PresetCategory,
    type PresetEntry,
    type PresetManifest,
} from 'virtual:screenmap-presets';

export type { PresetCategory, PresetEntry, PresetManifest };

export interface PresetPickerOptions {
    /** Visual density: compact for the Record sidebar, inline for Create. */
    mode: 'compact' | 'inline';
    /** Fires when the user clicks a preset button. Receives the file name. */
    onChoose: (file: string) => void | Promise<void>;
    /** Highlight this preset on mount and open its category. */
    initialSelection?: string;
    /** localStorage key for the open-category id. */
    storageKey?: string;
    /** Lifecycle abort: remove listeners + detach when fired. */
    signal?: AbortSignal;
    /** Override the baked manifest (used by shapeeditor's runtime fetch path). */
    presets?: PresetEntry[];
    /** Override the baked categories (used alongside `presets`). */
    categories?: PresetCategory[];
}

export interface PresetPickerHandle {
    /** Mark a preset button active (highlight) and open its category. */
    setActive(file: string): void;
    /** Detach event listeners and clear DOM. Idempotent. */
    destroy(): void;
}

const DEFAULT_STORAGE_KEY = 'lm.presetPicker.openCategory';
const OTHER_CATEGORY_ID = '__other';

interface RenderGroup {
    id: string;
    label: string;
    entries: PresetEntry[];
}

/**
 * Group presets by category id, preserving the manifest's category
 * order. Presets whose `category` does not match any known id (or is
 * missing) fall into a trailing "Other" group. Empty groups are
 * omitted so the picker never shows a category with zero entries.
 */
function groupPresets(presets: PresetEntry[], categories: PresetCategory[]): RenderGroup[] {
    const buckets = new Map<string, PresetEntry[]>();
    for (const cat of categories) buckets.set(cat.id, []);
    const otherBucket: PresetEntry[] = [];
    for (const p of presets) {
        const bucket = p.category ? buckets.get(p.category) : undefined;
        if (bucket) {
            bucket.push(p);
        } else {
            otherBucket.push(p);
        }
    }
    const groups: RenderGroup[] = [];
    for (const cat of categories) {
        const entries = buckets.get(cat.id) ?? [];
        if (entries.length > 0) groups.push({ id: cat.id, label: cat.label, entries });
    }
    if (otherBucket.length > 0) {
        groups.push({ id: OTHER_CATEGORY_ID, label: 'Other', entries: otherBucket });
    }
    return groups;
}

/** Find which group a preset file belongs to, or null if unknown. */
function categoryOf(file: string, groups: RenderGroup[]): string | null {
    for (const g of groups) {
        if (g.entries.some((e) => e.file === file)) return g.id;
    }
    return null;
}

/** Stable per-instance id so multiple pickers on the same page don't collide on aria-controls. */
let pickerUid = 0;

export function mountPresetPicker(
    host: HTMLElement,
    opts: PresetPickerOptions,
): PresetPickerHandle {
    const manifest: PresetManifest = opts.presets || opts.categories
        ? {
            presets: opts.presets ?? bakedManifest.presets,
            categories: opts.categories ?? bakedManifest.categories,
        }
        : bakedManifest;
    const presets = manifest.presets;
    const categories = manifest.categories ?? [];
    const groups = groupPresets(presets, categories);
    const storageKey = opts.storageKey ?? DEFAULT_STORAGE_KEY;
    const uid = ++pickerUid;

    // Decide which category to open first.
    let initialOpenId: string | null = null;
    if (opts.initialSelection) {
        initialOpenId = categoryOf(opts.initialSelection, groups);
    }
    if (!initialOpenId) {
        try {
            const stored = localStorage.getItem(storageKey);
            if (stored && groups.some((g) => g.id === stored)) {
                initialOpenId = stored;
            }
        } catch {
            // localStorage may throw in privacy mode — fall through.
        }
    }
    if (!initialOpenId) {
        const firstGroup = groups[0];
        if (firstGroup) initialOpenId = firstGroup.id;
    }

    // Build DOM.
    const root = document.createElement('div');
    root.className = 'preset-picker';
    root.dataset.mode = opts.mode;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Screenmap presets');

    const buttonsByFile = new Map<string, HTMLButtonElement>();
    const categoryEls = new Map<string, { wrapper: HTMLElement; header: HTMLButtonElement; body: HTMLElement }>();

    for (const group of groups) {
        const wrapper = document.createElement('div');
        wrapper.className = 'preset-category';
        wrapper.dataset.category = group.id;
        wrapper.dataset.open = String(group.id === initialOpenId);

        const bodyId = `preset-picker-${String(uid)}-${group.id}-body`;
        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'preset-category-header';
        header.setAttribute('aria-expanded', String(group.id === initialOpenId));
        header.setAttribute('aria-controls', bodyId);
        const chevronEl = document.createElement('span');
        chevronEl.className = 'preset-category-chevron';
        chevronEl.setAttribute('aria-hidden', 'true');
        const labelEl = document.createElement('span');
        labelEl.className = 'preset-category-label';
        labelEl.textContent = group.label;
        const countEl = document.createElement('span');
        countEl.className = 'preset-category-count';
        countEl.setAttribute('aria-hidden', 'true');
        countEl.textContent = String(group.entries.length);
        header.appendChild(chevronEl);
        header.appendChild(labelEl);
        header.appendChild(countEl);

        const body = document.createElement('div');
        body.id = bodyId;
        body.className = 'preset-category-body';
        body.setAttribute('role', 'group');
        body.setAttribute('aria-label', group.label);

        for (const entry of group.entries) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'preset-btn';
            btn.dataset.presetFile = entry.file;
            btn.textContent = entry.name;
            btn.addEventListener('click', () => {
                void Promise.resolve(opts.onChoose(entry.file)).catch((err: unknown) => {
                    console.error('preset-picker: onChoose threw', err);
                });
            }, { signal: opts.signal });
            buttonsByFile.set(entry.file, btn);
            body.appendChild(btn);
        }

        header.addEventListener('click', () => {
            const wasOpen = wrapper.dataset.open === 'true';
            // Single-open behavior: collapse all, then open the clicked one
            // if it was closed. Re-clicking the open one collapses it.
            for (const [, els] of categoryEls) {
                els.wrapper.dataset.open = 'false';
                els.header.setAttribute('aria-expanded', 'false');
            }
            if (!wasOpen) {
                wrapper.dataset.open = 'true';
                header.setAttribute('aria-expanded', 'true');
                try {
                    localStorage.setItem(storageKey, group.id);
                } catch {
                    // ignore privacy-mode failures
                }
            }
        }, { signal: opts.signal });

        wrapper.appendChild(header);
        wrapper.appendChild(body);
        root.appendChild(wrapper);
        categoryEls.set(group.id, { wrapper, header, body });
    }

    if (groups.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'preset-picker-empty';
        empty.textContent = 'No presets available.';
        root.appendChild(empty);
    }

    host.appendChild(root);

    // Highlight the initial selection if provided.
    if (opts.initialSelection) {
        const btn = buttonsByFile.get(opts.initialSelection);
        if (btn) btn.classList.add('active-preset');
    }

    function setActive(file: string): void {
        for (const btn of buttonsByFile.values()) btn.classList.remove('active-preset');
        const btn = buttonsByFile.get(file);
        if (!btn) return;
        btn.classList.add('active-preset');
        const cat = categoryOf(file, groups);
        if (cat && categoryEls.has(cat)) {
            for (const [id, els] of categoryEls) {
                const open = id === cat;
                els.wrapper.dataset.open = String(open);
                els.header.setAttribute('aria-expanded', String(open));
            }
        }
    }

    let destroyed = false;
    function destroy(): void {
        if (destroyed) return;
        destroyed = true;
        if (root.parentNode) root.parentNode.removeChild(root);
        buttonsByFile.clear();
        categoryEls.clear();
    }

    if (opts.signal) {
        opts.signal.addEventListener('abort', destroy, { once: true });
    }

    return { setActive, destroy };
}

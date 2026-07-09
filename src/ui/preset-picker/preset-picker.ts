/**
 * Shared segmented-tabs preset picker.
 *
 * One picker module used by Record (moviemaker, `mode: 'compact'`) and
 * Create (shapeeditor, `mode: 'inline'`). Presets are grouped into a
 * small number of categories; the picker shows the category tabs in
 * one row and the items for the active tab in the next row. Two rows
 * total at rest — issue #209 follow-up to the original accordion
 * shipped in #207 / #206 (the accordion's full-width category bars
 * were too dominant in the moviemaker top-bar layout).
 */

import bakedManifest, {
    type PresetCategory,
    type PresetEntry,
    type PresetManifest,
} from 'virtual:screenmap-presets';

export type { PresetCategory, PresetEntry, PresetManifest };

export interface PresetPickerOptions {
    /** Visual density: compact for the Record sidebar/top-bar, inline for Create. */
    mode: 'compact' | 'inline';
    /** Fires when the user clicks a preset button. Receives the file name. */
    onChoose: (file: string) => void | Promise<void>;
    /** Highlight this preset on mount and activate its category tab. */
    initialSelection?: string;
    /** localStorage key for the active-category id. */
    storageKey?: string;
    /** Lifecycle abort: remove listeners + detach when fired. */
    signal?: AbortSignal;
    /** Override the baked manifest (used by shapeeditor's runtime fetch path). */
    presets?: PresetEntry[];
    /** Override the baked categories (used alongside `presets`). */
    categories?: PresetCategory[];
}

export interface PresetPickerHandle {
    /** Mark a preset button active and switch the active tab to its category. */
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
 * omitted so the picker never shows a tab with zero entries.
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

    // Decide which tab is initially active.
    let activeId: string | null = null;
    if (opts.initialSelection) {
        activeId = categoryOf(opts.initialSelection, groups);
    }
    if (!activeId) {
        try {
            const stored = localStorage.getItem(storageKey);
            if (stored && groups.some((g) => g.id === stored)) {
                activeId = stored;
            }
        } catch {
            // localStorage may throw in privacy mode — fall through.
        }
    }
    if (!activeId) {
        const firstGroup = groups[0];
        if (firstGroup) activeId = firstGroup.id;
    }

    // Build DOM.
    const root = document.createElement('div');
    root.className = 'preset-picker';
    root.dataset.mode = opts.mode;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Screenmap presets');

    const tabsEl = document.createElement('div');
    tabsEl.className = 'preset-picker-tabs';
    tabsEl.setAttribute('role', 'tablist');

    const itemsEl = document.createElement('div');
    itemsEl.className = 'preset-picker-items';

    const tabsById = new Map<string, HTMLButtonElement>();
    const panelsById = new Map<string, HTMLElement>();
    const buttonsByFile = new Map<string, HTMLButtonElement>();

    function setActiveTab(id: string): void {
        if (!tabsById.has(id)) return;
        activeId = id;
        for (const [tabId, tab] of tabsById) {
            const selected = tabId === id;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
        }
        for (const [panelId, panel] of panelsById) {
            panel.hidden = panelId !== id;
        }
        try {
            localStorage.setItem(storageKey, id);
        } catch {
            // ignore privacy-mode failures
        }
    }

    for (const group of groups) {
        const tabId = `preset-picker-${String(uid)}-${group.id}-tab`;
        const panelId = `preset-picker-${String(uid)}-${group.id}-panel`;

        const tab = document.createElement('button');
        tab.type = 'button';
        tab.id = tabId;
        tab.className = 'preset-picker-tab';
        tab.dataset.category = group.id;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', panelId);
        tab.setAttribute('aria-selected', String(group.id === activeId));
        tab.tabIndex = group.id === activeId ? 0 : -1;

        const labelEl = document.createElement('span');
        labelEl.className = 'preset-picker-tab-label';
        labelEl.textContent = group.label;
        const countEl = document.createElement('span');
        countEl.className = 'preset-picker-tab-count';
        countEl.setAttribute('aria-hidden', 'true');
        countEl.textContent = String(group.entries.length);
        tab.appendChild(labelEl);
        tab.appendChild(countEl);

        tab.addEventListener('click', () => {
            setActiveTab(group.id);
        }, { signal: opts.signal });

        const panel = document.createElement('div');
        panel.id = panelId;
        panel.className = 'preset-picker-panel';
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tabId);
        panel.hidden = group.id !== activeId;

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
            panel.appendChild(btn);
        }

        tabsById.set(group.id, tab);
        panelsById.set(group.id, panel);
        tabsEl.appendChild(tab);
        itemsEl.appendChild(panel);
    }

    // Arrow-key navigation across tabs (WAI-ARIA tabs pattern).
    tabsEl.addEventListener('keydown', (e: KeyboardEvent) => {
        const order = Array.from(tabsById.keys());
        const currentIdx = activeId === null ? -1 : order.indexOf(activeId);
        if (currentIdx === -1) return;
        let nextIdx: number;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            nextIdx = (currentIdx + 1) % order.length;
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            nextIdx = (currentIdx - 1 + order.length) % order.length;
        } else if (e.key === 'Home') {
            nextIdx = 0;
        } else if (e.key === 'End') {
            nextIdx = order.length - 1;
        } else {
            return;
        }
        e.preventDefault();
        const nextId = order[nextIdx];
        if (nextId !== undefined) {
            setActiveTab(nextId);
            tabsById.get(nextId)?.focus();
        }
    }, { signal: opts.signal });

    root.appendChild(tabsEl);
    root.appendChild(itemsEl);

    if (groups.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'preset-picker-empty';
        empty.textContent = 'No presets available.';
        root.replaceChildren(empty);
    }

    host.appendChild(root);

    // Highlight the initial selection if provided.
    if (opts.initialSelection) {
        const btn = buttonsByFile.get(opts.initialSelection);
        if (btn) {
            btn.classList.add('active-preset');
            updateActiveTabIndicator(categoryOf(opts.initialSelection, groups));
        }
    }

    /** Tab-header hint: mark the (sole) tab holding the active preset, so it
     * stays identifiable even if the user switches to a different tab and
     * hides its panel. Cleared entirely when no preset is active. */
    function updateActiveTabIndicator(activeCategoryId: string | null): void {
        for (const [tabId, tab] of tabsById) {
            tab.classList.toggle('has-active-preset', tabId === activeCategoryId);
        }
    }

    function setActive(file: string): void {
        for (const btn of buttonsByFile.values()) btn.classList.remove('active-preset');
        const btn = file ? buttonsByFile.get(file) : undefined;
        if (!btn) {
            updateActiveTabIndicator(null);
            return;
        }
        btn.classList.add('active-preset');
        const cat = categoryOf(file, groups);
        updateActiveTabIndicator(cat);
        if (cat) setActiveTab(cat);
    }

    let destroyed = false;
    function destroy(): void {
        if (destroyed) return;
        destroyed = true;
        if (root.parentNode) root.parentNode.removeChild(root);
        buttonsByFile.clear();
        tabsById.clear();
        panelsById.clear();
    }

    if (opts.signal) {
        opts.signal.addEventListener('abort', destroy, { once: true });
    }

    return { setActive, destroy };
}

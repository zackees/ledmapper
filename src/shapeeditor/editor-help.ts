// Named ShapeEditor method bundle: help.
import type { ShapeEditor } from './shapeeditor-class';
import { safeStorage } from "../services/storage";
import { fireDialog } from "../ui/dialogs";
import { hintTextFor } from "./hints";

export interface EditorHelpMethods {
    _currentHintState: () => { empty: boolean; placing: boolean; placingLabel: string; pasting: boolean; pastingCount: number; pointEditMode: boolean; pointEditStripName: string; selectedStripName: string | null; chainMode: boolean; reorderMode: boolean };
    _updateHintStrip: () => void;
    _openHelpOverlay: () => Promise<void>;
    _maybeShowGestureNotice: () => void;
    _maybeAutoOpenHelpOnLaunch: () => void;
}

export const editorHelpMethods: EditorHelpMethods & ThisType<ShapeEditor> = {
    async _openHelpOverlay(this: ShapeEditor){

        try {
            if (this.signal.aborted) return;
            const dismissed = safeStorage.get('lm:shapeeditor-helpDismissed') === '1';
            const html = `
                <div class="help-overlay-grid">
                    <div>
                        <h3 class="help-overlay-h3">Mouse</h3>
                        <ul class="help-overlay-ul">
                            <li>Left drag empty space: select groups with a marquee</li>
                            <li>Right drag: pan canvas</li>
                            <li>Space + left drag or middle drag: pan</li>
                            <li>Wheel: zoom</li>
                            <li>Click LED: select its strip</li>
                            <li>Left drag group: select and move with snapping</li>
                            <li>Shift + left drag selected group: move freely</li>
                            <li>Double-click LED: enter point-edit, then drag one LED</li>
                            <li>Double-click LED: enter point-edit</li>
                            <li>Corner/edge/rotate handles: scale &amp; rotate layout</li>
                            <li>Shift + click edge: insert between</li>
                            <li>Ctrl + click: extend (append LED)</li>
                            <li>Ctrl + drag: shape select (rubber-band)</li>
                            <li>Ctrl + click LED: toggle in shape selection</li>
                            <li>Right-click: context menu</li>
                        </ul>
                    </div>
                    <div>
                        <h3 class="help-overlay-h3">Keyboard</h3>
                        <ul class="help-overlay-ul">
                            <li><b>I</b> — Insert panel</li>
                            <li><b>V</b> — Select mode</li>
                            <li><b>Space</b> — Hold to pan with left drag</li>
                            <li><b>Ctrl+V</b> — Paste screenmap</li>
                            <li><b>?</b> / <b>F1</b> — This help</li>
                            <li><b>Ctrl+Z</b> / <b>Ctrl+Y</b> — Undo / Redo</li>
                            <li><b>Delete</b> — Remove selection</li>
                            <li><b>Esc</b> — Cancel / exit point-edit</li>
                        </ul>
                        <h3 class="help-overlay-h3 is-spaced-top">Touch</h3>
                        <ul class="help-overlay-ul">
                            <li>Tap LED: select strip</li>
                            <li>Drag LED or strip line: move whole strip</li>
                            <li>Long-press LED: enter point-edit, then drag one LED</li>
                            <li>Drag empty space: pan</li>
                            <li>Long-press LED: enter point-edit</li>
                            <li>Long-press empty: context menu</li>
                            <li>Two-finger drag: pan</li>
                            <li>Pinch: zoom</li>
                        </ul>
                    </div>
                </div>
                <div id="help_chains_pins" class="help-overlay-section is-spaced-top">
                    <h3 class="help-overlay-h3">Chains and Pins</h3>
                    <ul class="help-overlay-ul">
                        <li><b>Chain</b> mode: drag a connector arrowhead to rewire strips; right-click an arrow for Swap / Split / Move options</li>
                        <li><b>Reorder</b> mode: move strips within a pin with the ▲/▼ arrows; drag a grip across pin headers to repin</li>
                        <li><b>+ Pin</b>: move the selected strip onto a fresh pin</li>
                        <li><b>LOCK</b> (🔓/🔒) overrides a strip's <code>video_offset</code>; unlocked values re-derive from pin order</li>
                        <li>Pin names are labels; export order, not name, determines FastLED <code>addLeds</code> call order</li>
                    </ul>
                </div>
                <div class="help-overlay-dismiss-row">
                    <label class="help-overlay-dismiss-label">
                        <input id="help_dont_show" type="checkbox" ${dismissed ? 'checked' : ''}>
                        Don't show on launch
                    </label>
                </div>
            `;
            const res = await fireDialog({
                title: 'ScreenMap Editor — Keyboard help',
                html,
                width: 640,
                confirmButtonText: 'Got it',
                showCloseButton: true,
                focusConfirm: false,
                // preConfirm returning false would block the popup from
                // closing, so wrap the checkbox state in an object.
                preConfirm: () => {
                    const cb = document.getElementById('help_dont_show');
                    return { dontShow: cb ? (cb as HTMLInputElement).checked : false };
                },
            });
            // Only the confirm button reports the checkbox; closing via the
            // × or Esc leaves the stored preference untouched.
            if (res.isConfirmed && res.value) {
                const resVal: unknown = res.value;
                const dontShow = typeof resVal === 'object' && resVal !== null
                    && 'dontShow' in resVal && (resVal as Record<string, unknown>).dontShow === true;
                if (dontShow) {
                    safeStorage.set('lm:shapeeditor-helpDismissed', '1');
                } else {
                    safeStorage.remove('lm:shapeeditor-helpDismissed');
                }
            }
        } catch { /* swal may fail in headless edge cases */ }
    },
    _maybeShowGestureNotice(this: ShapeEditor){

        if (this._gestureNoticeShown) return;
        const sIdx = this.selection.getStripIdx();
        if (sIdx === null || sIdx < 0) return;
        if (safeStorage.get('lm:shapeeditor-gestureNotice') === '1') {
            this._gestureNoticeShown = true;
            return;
        }
        // Don't stack on top of the first-run help modal — skip if the
        // dismissal key is missing (help is about to auto-open or did).
        if (safeStorage.get('lm:shapeeditor-helpDismissed') !== '1') return;
        this._gestureNoticeShown = true;
        safeStorage.set('lm:shapeeditor-gestureNotice', '1');
        void this._toastInfo('Selected group: drag to move • right-drag to pan canvas • double-click an LED to edit points');
    },
    _maybeAutoOpenHelpOnLaunch(this: ShapeEditor){

        if (this._autoOpenHelpScheduled) return;
        this._autoOpenHelpScheduled = true;
        if (safeStorage.get('lm:shapeeditor-helpDismissed') === '1') return;
        // First run gets a one-line nudge toast, not the full ~30-shortcut
        // reference dumped over the canvas before the tool is even seen (#290).
        // The complete keyboard help stays one keypress away — ?, F1, or the
        // "? Help" button in the hint strip.
        setTimeout(() => {
            if (this.signal.aborted) return;
            void this._toastInfo('Drag a group to select and move · drag empty space to marquee · press ? for all shortcuts');
        }, 400);
    },
    _currentHintState(this: ShapeEditor){

        const selStripIdx = this.selection.getStripIdx();
        const strips = this.stripStore.getStrips();
        let selectedStripName = null;
        if (selStripIdx !== null && selStripIdx >= 0 && selStripIdx < strips.length) {
            selectedStripName = this.nn(strips[selStripIdx]).name;
        }
        let pointEditStripName = '';
        if (this.pointEditStripIdx !== null && this.pointEditStripIdx >= 0 && this.pointEditStripIdx < strips.length) {
            pointEditStripName = this.nn(strips[this.pointEditStripIdx]).name;
        }
        return {
            empty: !this.stripInfo || this.stripInfo.strips.length === 0
                || (this.stripInfo.strips.length === 1 && (this.stripInfo.strips[0]?.count ?? 0) <= 1
                    && this.stripInfo.totalCount <= 1),
            placing: !!this.placingState,
            placingLabel: this.placingState?.entry.label ?? '',
            pasting: !!this.pasteState,
            pastingCount: this.pasteState ? this.pasteState.strips.length : 0,
            pointEditMode: this.pointEditStripIdx !== null,
            pointEditStripName,
            selectedStripName,
            chainMode: this.editorMode === 'chain',
            reorderMode: this.editorMode === 'reorder',
        };
    },
    _updateHintStrip(this: ShapeEditor){

        if (!this.hintStripTextEl) return;
        this.hintStripTextEl.textContent = hintTextFor(this._currentHintState());
    },
};

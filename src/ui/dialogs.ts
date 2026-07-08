/**
 * Themed SweetAlert2 wrappers for the project's dark-mode dialog look.
 *
 * Issue #119 Phase 4 — consolidates 14 ad-hoc `const Swal = (await
 * import('sweetalert2')).default` lazy-imports plus the `{ background:
 * '#1a1a1a', color: '#e5e7eb' }` theme that every Swal call site
 * pastes alongside its options.
 *
 * `fireDialog` is byte-for-byte UX equivalent for the existing
 * `Swal.fire` callsites — same theme, just via one shared entry point.
 * `errorDialog` replaces the previously-scattered browser-native
 * `alert()` calls with the themed Swal popup (issue #128 follow-up to
 * the wrapper itself).
 */

import type SweetAlert2 from 'sweetalert2';
import type { SweetAlertOptions } from 'sweetalert2';
import { cssVar } from './theme';
import { buildDiagnosticsPayload } from './diagnostics';

const swalPromise: Promise<typeof SweetAlert2> = import('sweetalert2').then((m) => m.default);

/** Theme tokens applied to every dialog so they match the LM design
 *  system. Reads CSS variables at call time (issue #170) so a runtime
 *  theme swap propagates without touching this code. */
function buildTheme(): { background: string; color: string } {
    return {
        background: cssVar('--color-lm-surface-2'),
        color: cssVar('--color-lm-text'),
    };
}

/**
 * Get the raw Swal singleton. Used by callsites that need imperative
 * APIs like `Swal.showValidationMessage` from inside a `preConfirm`
 * callback.
 */
export async function getSwal(): Promise<typeof SweetAlert2> {
    return swalPromise;
}

/**
 * Fire a Swal dialog with the project's dark theme applied. Caller-
 * supplied options override the theme; everything else is forwarded
 * verbatim to `Swal.fire`. Result type matches `Swal.fire`'s.
 */
export async function fireDialog<T = unknown>(opts: SweetAlertOptions) {
    const s = await swalPromise;
    return s.fire<T>({ ...buildTheme(), ...opts });
}

const DIAGNOSTICS_BUTTON_SELECTOR = '.diagnostics-copy-btn';
const DIAGNOSTICS_PRE_SELECTOR = '.diagnostics-payload-pre';

function diagnosticsFooterHtml(): string {
    return (
        '<div class="diagnostics-footer">' +
        '<button type="button" class="diagnostics-copy-btn">Copy diagnostics</button>' +
        '</div>' +
        '<pre class="diagnostics-payload-pre diagnostics-payload-hidden"></pre>'
    );
}

/** Legacy clipboard fallback for browsers without (or that refuse)
 *  `navigator.clipboard` — an off-screen `<textarea>` + `execCommand('copy')`.
 *  `execCommand` is deprecated but still the only synchronous fallback path;
 *  wrapped in try/catch since it can throw in some embedding contexts. */
function legacyCopyToClipboard(text: string): boolean {
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.className = 'diagnostics-legacy-textarea';
        document.body.appendChild(textarea);
        textarea.select();
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- intentional legacy fallback (see doc comment above)
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    } catch {
        return false;
    }
}

async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return legacyCopyToClipboard(text);
    }
}

/** Bound in `didOpen`, per the upstream-recommended pattern for custom
 *  footer buttons (sweetalert2#2516) — a footer button isn't one of Swal's
 *  own confirm/cancel/deny buttons, so clicking it never auto-closes the
 *  dialog. On success the label flips to "Copied ✓" in place; on total
 *  clipboard failure the payload is revealed in a scrollable `<pre>` so
 *  the user can select-and-copy it manually. */
function wireDiagnosticsFooter(popup: HTMLElement, payload: string): void {
    const button = popup.querySelector(DIAGNOSTICS_BUTTON_SELECTOR);
    const pre = popup.querySelector(DIAGNOSTICS_PRE_SELECTOR);
    if (!(button instanceof HTMLButtonElement) || !(pre instanceof HTMLElement)) return;

    button.addEventListener('click', () => {
        void (async () => {
            const ok = await copyToClipboard(payload);
            if (ok) {
                button.textContent = 'Copied ✓';
                button.classList.add('diagnostics-copy-btn-done');
                return;
            }
            pre.textContent = payload;
            pre.classList.remove('diagnostics-payload-hidden');
        })();
    });
}

/** Standard "something went wrong" dialog. Returns when the user dismisses.
 *  Every error dialog gets a "Copy diagnostics" footer button (issue
 *  #230) so a bug report can carry a full diagnostics snapshot instead of
 *  a one-line description. */
export async function errorDialog(title: string, text: string): Promise<void> {
    const payload = buildDiagnosticsPayload({ title, message: text });
    await fireDialog({
        title,
        text,
        icon: 'error',
        footer: diagnosticsFooterHtml(),
        didOpen: (popup) => { wireDiagnosticsFooter(popup, payload); },
    });
}

/** Standard informational dialog. */
export async function infoDialog(title: string, text: string): Promise<void> {
    await fireDialog({ title, text, icon: 'info' });
}

/**
 * Yes/cancel confirmation. Returns `true` if the user clicked the
 * confirm button. The cancel path (including ESC / backdrop click)
 * resolves to `false`.
 */
export async function confirmDialog(
    title: string,
    text: string,
    opts?: { confirmText?: string; cancelText?: string },
): Promise<boolean> {
    const res = await fireDialog({
        title,
        text,
        icon: 'question',
        showCancelButton: true,
        focusCancel: true,
        confirmButtonText: opts?.confirmText ?? 'Yes',
        cancelButtonText: opts?.cancelText ?? 'Cancel',
    });
    return res.isConfirmed;
}

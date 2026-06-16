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

/** Standard "something went wrong" dialog. Returns when the user dismisses. */
export async function errorDialog(title: string, text: string): Promise<void> {
    await fireDialog({ title, text, icon: 'error' });
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

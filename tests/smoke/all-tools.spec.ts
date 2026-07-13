import { test, expect, type ConsoleMessage } from '@playwright/test';

// Production-build smoke test. Loads each tool from the built dist/ via
// `vite preview` and asserts:
//   * the page reaches its main element (canvas or #main)
//   * no console errors fire during init
//   * no page-level errors fire during init
//
// If a production bundle is broken (tree-shaking dropped a side-effect
// import, a dynamic import path is wrong, CSS load-order issue, etc.)
// this test fails — the dev-mode integration suite cannot catch any of
// those because Vite serves source modules un-bundled in dev.

interface ToolRoute {
    path: string;
    name: string;
    // CSS selector to wait for as the "the tool finished mounting" signal.
    // app shell has a mode bar; screenmap shows a source-picker (webcam/upload)
    // before mounting its canvas.
    readySelector: string;
}

const tools: ToolRoute[] = [
    { path: '/',             name: 'app-root',    readySelector: '#app-mode-bar, canvas' },
    { path: '/play',         name: 'app-play',    readySelector: '#app-mode-bar, canvas' },
    { path: '/create',       name: 'app-create',  readySelector: '#app-mode-bar, canvas' },
    { path: '/record',       name: 'app-record',  readySelector: '#app-mode-bar, canvas' },
    { path: '/demo/',        name: 'demo',        readySelector: 'canvas' },
    { path: '/screenmap/',   name: 'screenmap',   readySelector: '#btn_webcam, #btn_upload, canvas' },
    { path: '/moviemaker/',  name: 'moviemaker',  readySelector: 'canvas' },
    { path: '/movieplayer/', name: 'movieplayer', readySelector: 'canvas' },
    { path: '/shapeeditor/', name: 'shapeeditor', readySelector: 'canvas' },
];

// Console messages we tolerate during a clean page load. Tools sometimes
// log informational messages on init (e.g. preset manifest fetch results).
// Keep this list small and concrete — every entry is an exception.
const IGNORED_ERROR_PATTERNS: RegExp[] = [
    // Vite's "failed to load resource" for the favicon is harmless and
    // unrelated to tool init.
    /favicon\.ico/i,
];

for (const tool of tools) {
    test(`${tool.name} loads from production build without errors`, async ({ page }) => {
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];

        page.on('pageerror', (e: Error) => {
            pageErrors.push(`${e.name}: ${e.message}`);
        });
        page.on('console', (msg: ConsoleMessage) => {
            if (msg.type() !== 'error') return;
            const text = msg.text();
            if (IGNORED_ERROR_PATTERNS.some((re) => re.test(text))) return;
            consoleErrors.push(text);
        });

        await page.goto(tool.path);
        await expect(page.locator(tool.readySelector).first()).toBeVisible({ timeout: 10000 });

        expect(pageErrors, `pageerror events: ${pageErrors.join(' | ')}`).toEqual([]);
        expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    });
}

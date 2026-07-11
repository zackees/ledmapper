import { initNav } from './nav';
import { createRouter } from './router';
import './agent-ui-sentinel';

// Handle GitHub Pages 404 redirect
const redirect = sessionStorage.getItem('spa-redirect');
if (redirect) {
    sessionStorage.removeItem('spa-redirect');
    history.replaceState(null, '', redirect);
}

const appEl = document.getElementById('app');
if (!appEl) throw new Error('Missing #app element');
const router = createRouter(appEl);
initNav();

// Load initial route
router.start();

// Dev-only debug panel (stats-gl + lil-gui + eruda) — issue #228. Dynamically
// imported ONLY behind this flag so its dependencies never enter the mainline
// bundle for normal users.
function isDebugPanelRequested(): boolean {
    if (new URLSearchParams(location.search).has('debug')) return true;
    try {
        return localStorage.getItem('lm:debug-panel') !== null;
    } catch {
        return false; // localStorage unavailable (e.g. private-mode restrictions)
    }
}

if (isDebugPanelRequested()) {
    import('./debug-panel').then((mod) => {
        mod.initDebugPanel();
    }).catch((err: unknown) => {
        console.error('Failed to load debug panel:', err);
    });
}

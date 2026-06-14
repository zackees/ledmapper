import { initNav } from './nav';
import { createRouter } from './router';

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

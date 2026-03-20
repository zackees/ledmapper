import { initNav } from './nav.js';
import { createRouter } from './router.js';

// Handle GitHub Pages 404 redirect
const redirect = sessionStorage.getItem('spa-redirect');
if (redirect) {
    sessionStorage.removeItem('spa-redirect');
    history.replaceState(null, '', redirect);
}

const router = createRouter(document.getElementById('app'));
initNav((path) => router.navigate(path));

// Load initial route
router.start();

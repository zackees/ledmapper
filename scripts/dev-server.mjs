#!/usr/bin/env node
/**
 * Blessed persistent dev server for agent iteration (ui-dev-loop skill).
 *
 * One command covers the whole lifecycle: starts (or detects and reuses)
 * the dev server, waits until it's actually serving requests, prints a
 * machine-readable ready line, then stays alive until killed. Replaces the
 * old two-step pattern (`npm run dev` backgrounded + a hand-rolled curl
 * poll loop) that the ui-dev-loop skill used to teach.
 *
 * Started in-process via Vite's own JS API (`createServer`/`server.close()`)
 * -- same rationale as scripts/run-playwright.mjs: there's no child
 * process to leak, so even an ungraceful kill (not just Ctrl-C) frees the
 * port immediately, no taskkill/tree-kill needed on any platform.
 *
 * Usage:
 *   node scripts/dev-server.mjs
 *   npm run dev:agent
 *
 * Prints `DEV-SERVER-READY <url>` on its own line once the server answers
 * requests -- wait on that line instead of polling. If a server is already
 * running on the port, prints the ready line immediately and exits 0
 * without touching it (it isn't this invocation's to manage).
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import { createServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const PORT = 8080;
const hasCerts = existsSync(join(repoRoot, '.certs', 'cert.pem')) && existsSync(join(repoRoot, '.certs', 'key.pem'));
const protocol = hasCerts ? 'https' : 'http';
const url = `${protocol}://localhost:${String(PORT)}`;

function checkServerUp() {
    return new Promise((resolve) => {
        const mod = protocol === 'https' ? https : http;
        const req = mod.get(
            { hostname: 'localhost', port: PORT, path: '/', rejectUnauthorized: false, timeout: 1500 },
            (res) => { res.resume(); resolve(true); },
        );
        req.on('error', () => { resolve(false); });
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

async function waitForServer(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await checkServerUp()) return true;
        await new Promise((r) => setTimeout(r, 400));
    }
    return false;
}

async function main() {
    if (await checkServerUp()) {
        console.log(`[dev-server] reusing existing server on ${url}`);
        console.log(`DEV-SERVER-READY ${url}`);
        console.log("[dev-server] not managing this server's lifecycle -- it was already running before this command.");
        process.exit(0);
    }

    const viteServer = await createServer({
        configFile: join(repoRoot, 'vite.config.js'),
        server: { open: false },
    });
    await viteServer.listen();

    const up = await waitForServer(20000);
    if (!up) {
        console.error('[dev-server] server did not come up in time; aborting.');
        await viteServer.close();
        process.exit(1);
    }

    console.log(`DEV-SERVER-READY ${url}`);

    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`[dev-server] ${signal} received, shutting down...`);
        viteServer.close().finally(() => { process.exit(0); });
    };
    process.on('SIGINT', () => { shutdown('SIGINT'); });
    process.on('SIGTERM', () => { shutdown('SIGTERM'); });

    // Keep the event loop alive until a signal arrives (or the process is
    // killed outright -- since everything runs in this one process, the OS
    // reclaims the port the moment it dies either way).
    await new Promise(() => { /* runs until killed */ });
}

main();

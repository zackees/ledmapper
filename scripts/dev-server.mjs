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
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const hasCerts = existsSync(join(repoRoot, '.certs', 'cert.pem')) && existsSync(join(repoRoot, '.certs', 'key.pem'));
const protocol = hasCerts ? 'https' : 'http';

function parseArgs(args) {
    let port = 0;
    let open = false;
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--open') {
            open = true;
        } else if (arg === '--port') {
            port = Number(args[i + 1]);
            i += 1;
        } else if (arg.startsWith('--port=')) {
            port = Number(arg.slice('--port='.length));
        }
    }
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error('--port must be an integer from 0 through 65535');
    }
    return { open, port };
}

function openNewWindow(url) {
    console.log(`[dev-server] opening new browser window: ${url}`);
    if (process.platform === 'win32') {
        const browser = ['msedge', 'chrome', 'firefox'].find((name) => (
            spawnSync('where.exe', [name], { stdio: 'ignore' }).status === 0
        ));
        const command = browser ? [browser, '--new-window', url] : ['explorer.exe', url];
        spawn(command[0], command.slice(1), {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        }).unref();
    } else if (process.platform === 'darwin') {
        spawn('open', ['-n', url], { detached: true, stdio: 'ignore' }).unref();
    } else {
        const browser = ['google-chrome', 'chromium', 'firefox'].find((name) => (
            spawnSync('which', [name], { stdio: 'ignore' }).status === 0
        ));
        spawn(browser || 'xdg-open', browser ? ['--new-window', url] : [url], {
            detached: true,
            stdio: 'ignore',
        }).unref();
    }
}

function findFreePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, 'localhost', () => {
            const address = probe.address();
            const port = typeof address === 'object' && address !== null ? address.port : null;
            probe.close((error) => {
                if (error) reject(error);
                else if (port === null) reject(new Error('OS did not provide a free port'));
                else resolve(port);
            });
        });
    });
}

function checkServerUp(port) {
    return new Promise((resolve) => {
        const mod = protocol === 'https' ? https : http;
        const req = mod.get(
            { hostname: 'localhost', port, path: '/', rejectUnauthorized: false, timeout: 1500 },
            (res) => { res.resume(); resolve(true); },
        );
        req.on('error', () => { resolve(false); });
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

async function waitForServer(port, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await checkServerUp(port)) return true;
        await new Promise((r) => setTimeout(r, 400));
    }
    return false;
}

async function main() {
    const { open, port: requestedPort } = parseArgs(process.argv.slice(2));
    const port = requestedPort === 0 ? await findFreePort() : requestedPort;
    if (await checkServerUp(port)) {
        const url = `${protocol}://localhost:${String(port)}`;
        console.log(`[dev-server] reusing existing server on ${url}`);
        if (open) openNewWindow(`${url}/`);
        console.log(`DEV-SERVER-READY ${url}`);
        console.log("[dev-server] not managing this server's lifecycle -- it was already running before this command.");
        process.exit(0);
    }

    const viteServer = await createServer({
        configFile: join(repoRoot, 'vite.config.js'),
        server: { open: false, port, strictPort: true },
    });
    await viteServer.listen();

    const address = viteServer.httpServer?.address();
    const actualPort = typeof address === 'object' && address !== null ? address.port : port;
    const url = `${protocol}://localhost:${String(actualPort)}`;
    const up = await waitForServer(actualPort, 20000);
    if (!up) {
        console.error('[dev-server] server did not come up in time; aborting.');
        await viteServer.close();
        process.exit(1);
    }

    console.log(`DEV-SERVER-READY ${url}`);
    if (open) openNewWindow(`${url}/`);

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

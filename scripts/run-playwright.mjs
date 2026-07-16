#!/usr/bin/env node
/**
 * Blessed Playwright runner (issue: speed up testing / agent dev-loop).
 *
 * Direct `npx playwright test` / `playwright test` invocations are blocked
 * for agents by `.claude/hooks/check-playwright.py` (a PreToolUse hook) —
 * this script is the only sanctioned way to run the integration suite.
 * Reasons this exists instead of a bare Playwright invocation:
 *
 *  - Defaults `--workers` to a safe, bounded number. An unconstrained local
 *    run (Playwright's default is ~CPU-core-count workers, each launching
 *    its own browser) was observed to silently die mid-run on this machine
 *    -- no crash message, dev server and every Chrome process just gone.
 *    Mirrors a documented CI OOM issue (see playwright.config.js, and
 *    issue about CI shard workers=1) but worse locally with more workers.
 *  - Never forces `CI=1`. Setting it locally makes playwright.config.js's
 *    `reuseExistingServer` flip to false, so every invocation rebuilds and
 *    serves a fresh production preview instead of reusing an already-
 *    running dev server -- roughly doubles wall-clock for no benefit
 *    locally.
 *  - Tees all output to a gitignored log file under .temp/logs/ and prints
 *    a compact tail instead of the full firehose, so an agent isn't stuck
 *    scrolling through hundreds of lines to find the result.
 *  - Manages the dev server it starts (if any) via Vite's own JS API
 *    (`createServer`/`server.close()`), not by shelling out to `npm run
 *    dev` as a child process. That avoids the classic orphan-process trap:
 *    `npm run dev` -> shell -> vite is 2-3 processes deep, and killing just
 *    the top one (especially on Windows) leaves the actual server running
 *    on the port. Running Vite in-process means there's nothing to orphan.
 *
 * Usage:
 *   node scripts/run-playwright.mjs                  # run everything
 *   node scripts/run-playwright.mjs moviemaker        # filter by name
 *   node scripts/run-playwright.mjs moviemaker.spec.ts
 *   node scripts/run-playwright.mjs --verbose ...     # stream full output live
 *   node scripts/run-playwright.mjs --workers=1 ...   # override the default cap
 *
 * All other args are passed through verbatim to `npx playwright test`.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, createWriteStream, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finished } from 'node:stream/promises';
import http from 'node:http';
import https from 'node:https';
import { createServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const logDir = join(repoRoot, '.temp', 'logs');

const PORT = 8080;
const hasCerts = existsSync(join(repoRoot, '.certs', 'cert.pem')) && existsSync(join(repoRoot, '.certs', 'key.pem'));
const protocol = hasCerts ? 'https' : 'http';

// Cap unless the caller already passed their own --workers=N.
const DEFAULT_WORKERS = Number(process.env.PW_WORKERS) || 4;

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

function timestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function main() {
    const rawArgs = process.argv.slice(2);
    const verbose = rawArgs.includes('--verbose');
    const passthrough = rawArgs.filter((a) => a !== '--verbose');
    const hasWorkersFlag = passthrough.some((a) => a === '--workers' || a.startsWith('--workers='));
    const playwrightArgs = ['playwright', 'test', ...passthrough];
    if (!hasWorkersFlag) playwrightArgs.push(`--workers=${String(DEFAULT_WORKERS)}`);

    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `playwright-${timestamp()}.log`);
    const logStream = createWriteStream(logPath, { flags: 'a' });

    // Started in-process via Vite's JS API (not `npm run dev` as a child
    // process) specifically so teardown is a plain `server.close()` -- no
    // process tree to track, no OS-specific kill command needed. An
    // already-running server (the common case once an agent has one up for
    // the ui-dev-loop skill) is detected and left completely untouched.
    let viteServer = null;
    const alreadyUp = await checkServerUp();
    if (!alreadyUp) {
        console.log(`[run-playwright] starting dev server (nothing on :${String(PORT)})...`);
        logStream.write(`[run-playwright] starting dev server on demand\n`);
        // `open: false` overrides vite.config.js's `server.open: '/'` --
        // that's meant for a human running `npm run dev` once, not for a
        // test runner that may start a server many times in a session.
        viteServer = await createServer({
            configFile: join(repoRoot, 'vite.config.js'),
            // Integration tests use the fixed baseURL in playwright.config.js;
            // interactive dev servers deliberately use an OS-selected port.
            server: { open: false, port: PORT, strictPort: true },
        });
        try {
            await viteServer.listen();
        } catch (err) {
            // Another process (e.g. a concurrent runner invocation) may have
            // grabbed the port between our check and listen() -- fall back
            // to reuse mode instead of crashing.
            console.error(`[run-playwright] failed to start dev server (${String(err)}); checking if something else claimed the port...`);
            await viteServer.close().catch(() => { /* best-effort cleanup of the half-started server */ });
            viteServer = null;
            if (!(await checkServerUp())) {
                logStream.end();
                await finished(logStream);
                process.exit(1);
            }
        }
        if (viteServer) {
            const up = await waitForServer(20000);
            if (!up) {
                console.error('[run-playwright] dev server did not come up in time; aborting.');
                logStream.end();
                await finished(logStream);
                await viteServer.close();
                process.exit(1);
            }
        }
    } else {
        console.log(`[run-playwright] reusing existing dev server on :${String(PORT)}`);
    }

    console.log(`[run-playwright] npx ${playwrightArgs.join(' ')}`);
    console.log(`[run-playwright] logging to ${logPath}`);
    logStream.write(`$ npx ${playwrightArgs.join(' ')}\n\n`);

    const exitCode = await new Promise((resolve) => {
        // CI is deliberately left unset -- see the module docstring.
        const child = spawn('npx', playwrightArgs, {
            cwd: repoRoot,
            shell: process.platform === 'win32',
            env: process.env,
        });
        child.stdout.on('data', (chunk) => {
            logStream.write(chunk);
            if (verbose) process.stdout.write(chunk);
        });
        child.stderr.on('data', (chunk) => {
            logStream.write(chunk);
            if (verbose) process.stderr.write(chunk);
        });
        // 'close' (not 'exit') -- fires after stdio is fully drained, so
        // every chunk has already reached the logStream.write() calls above
        // by the time this resolves. 'exit' can fire while data is still
        // in flight, which was truncating the tail summary below.
        child.on('close', (code) => resolve(code ?? 1));
        child.on('error', () => resolve(1));
    });

    logStream.end();
    await finished(logStream);

    if (viteServer) {
        await viteServer.close();
    }

    if (!verbose) {
        const full = readFileSync(logPath, 'utf-8');
        const lines = full.split('\n');
        const tail = lines.slice(-40).join('\n');
        console.log('');
        console.log('--- tail of run (last 40 lines; full log below) ---');
        console.log(tail);
    }
    console.log('');
    console.log(`[run-playwright] full log: ${logPath}`);
    console.log(`[run-playwright] exit code: ${String(exitCode)}`);

    process.exit(exitCode);
}

main();

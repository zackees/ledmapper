/**
 * Converts Vite's HMR event stream into a small queryable state object,
 * `window.__agentUi`, so a coding agent can wait on an explicit
 * "update applied" signal instead of sleeping and guessing (issue #320).
 *
 * Dev-only: gated on `import.meta.env.DEV && import.meta.hot` so this file
 * is fully tree-shaken out of production builds.
 */

import { createLogger } from './debug-log';

export type AgentUiPhase = 'idle' | 'updating' | 'ready' | 'error' | 'disconnected';

export interface AgentUiState {
    phase: AgentUiPhase;
    update: number;
    lastUpdateAt?: number;
    error?: unknown;
}

declare global {
    interface Window {
        __agentUi?: AgentUiState;
    }
}

if (import.meta.env.DEV && import.meta.hot) {
    const log = createLogger('agent-ui');

    window.__agentUi ??= { phase: 'ready', update: 0 };
    const state: AgentUiState = window.__agentUi;

    import.meta.hot.on('vite:beforeUpdate', () => {
        state.phase = 'updating';
        log.info('phase', { phase: 'updating' });
    });

    import.meta.hot.on('vite:afterUpdate', () => {
        state.phase = 'ready';
        state.update++;
        state.lastUpdateAt = Date.now();
        delete state.error;
        log.info('phase', { phase: 'ready', update: state.update });
    });

    import.meta.hot.on('vite:error', (error: unknown) => {
        state.phase = 'error';
        state.error = error;
        log.error('phase', { phase: 'error', error });
    });

    // No module in this codebase currently calls `import.meta.hot.accept()`,
    // so most JS/TS edits fall through to Vite's full-reload fallback rather
    // than an in-place patch (CSS edits *do* patch in place — Vite HMRs CSS
    // without requiring an accept boundary). This handler exists so the
    // phase still reflects "an update is in flight" for the brief window
    // before the reload happens; the sentinel re-initializes fresh
    // (phase: 'ready', update: 0) once the new page loads.
    import.meta.hot.on('vite:beforeFullReload', () => {
        state.phase = 'updating';
        log.info('phase', { phase: 'updating', reload: true });
    });

    import.meta.hot.on('vite:ws:disconnect', () => {
        state.phase = 'disconnected';
        log.error('phase', { phase: 'disconnected' });
    });

    import.meta.hot.on('vite:ws:connect', () => {
        state.phase = 'ready';
        log.info('phase', { phase: 'ready' });
    });
}

export {};

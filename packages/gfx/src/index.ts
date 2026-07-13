/**
 * @fastled/gfx — npm-publishable entry point.
 *
 * This file is the package's public surface. It re-exports the canonical
 * implementation from this package's own source tree. The Vite library
 * build inlines the transitive renderer modules; `three` is left as a peer
 * dependency so consumers control the version.
 *
 * Issue #157 Phase 1 deliverable.
 */

export * from './gfx/index.js';

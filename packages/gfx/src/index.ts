/**
 * @fastled/gfx — npm-publishable entry point.
 *
 * This file is the package's public surface. It re-exports the canonical
 * implementation from `ledmapper/src/gfx/` so the source of truth stays
 * in one place. The Vite library build inlines the transitive
 * `src/auto-bloom`, `src/bloom-utils`, `src/render/*`, `src/three-utils`,
 * etc. into the published bundle; `three` is left as a peer dependency
 * so consumers control the version.
 *
 * Issue #157 Phase 1 deliverable.
 */

export * from '../../../src/gfx';

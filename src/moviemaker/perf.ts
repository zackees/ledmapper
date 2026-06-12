/**
 * Opt-in perf instrumentation (?perfdebug=1). Counters let e2e tests assert
 * deterministically that hot paths (position uploads, ring-layer redraws)
 * do not run per frame, without flaky FPS measurements.
 */

import type { PerfCounters } from '../types/domain';

export const perfEnabled = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('perfdebug');

if (perfEnabled) {
    window.__perf = { transformRebuilds: 0, positionUploads: 0, ringLayerRebuilds: 0 };
}

export function perfCount(name: keyof PerfCounters): void {
    if (!perfEnabled) return;
    const p: PerfCounters = window.__perf ?? { transformRebuilds: 0, positionUploads: 0, ringLayerRebuilds: 0 };
    window.__perf = p;
    p[name] = (p[name] || 0) + 1;
}

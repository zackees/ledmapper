import type { ProductionConfig } from './contract';

export const PRODUCTION_PHASES = [
    'booting', 'awaiting-input', 'validating-input', 'ready', 'rendering',
    'encoding', 'completed', 'failed', 'cancelled',
] as const;

export type ProductionPhase = typeof PRODUCTION_PHASES[number];
export type ProductionArtifactKind = 'fled' | 'mp4';

export interface ProductionError {
    code: string;
    message: string;
}

export interface ProductionInputMetadata {
    sourceArchiveUrl: string;
    videoFilename: string;
    screenmapFilename: string;
    videoByteSize: number;
    screenmapByteSize: number;
    ledCount?: number;
    stripCount?: number;
    width?: number;
    height?: number;
}

export interface ProductionProgress {
    completedFrames: number;
    totalFrames: number;
    fraction: number;
    fps?: number;
}

export interface ProductionArtifact {
    kind: ProductionArtifactKind;
    filename: string;
    mimeType: string;
    byteSize: number;
    frameCount: number;
    fps: number;
}

export interface ProductionState {
    phase: ProductionPhase;
    config: ProductionConfig | null;
    expectedArtifacts: ProductionArtifactKind[];
    inputMetadata: ProductionInputMetadata | null;
    progress: ProductionProgress;
    artifacts: ProductionArtifact[];
    error: ProductionError | null;
}

const PHASE_INDEX = new Map(PRODUCTION_PHASES.map((phase, index) => [phase, index]));
const TERMINAL = new Set<ProductionPhase>(['completed', 'failed', 'cancelled']);

export function expectedProductionArtifacts(config: ProductionConfig | null): ProductionArtifactKind[] {
    if (!config) return [];
    if (config.output === 'both') return ['fled', 'mp4'];
    return [config.output];
}

export function createProductionState(config: ProductionConfig | null): ProductionState {
    return {
        phase: config ? 'awaiting-input' : 'failed',
        config,
        expectedArtifacts: expectedProductionArtifacts(config),
        inputMetadata: null,
        progress: { completedFrames: 0, totalFrames: 0, fraction: 0 },
        artifacts: [],
        error: null,
    };
}

/** Enforce forward-only lifecycle transitions, with terminal states immutable. */
export function canTransitionProductionPhase(from: ProductionPhase, to: ProductionPhase): boolean {
    if (from === to || TERMINAL.has(from)) return false;
    if (to === 'failed' || to === 'cancelled') return true;
    const fromIndex = PHASE_INDEX.get(from);
    const toIndex = PHASE_INDEX.get(to);
    return fromIndex !== undefined && toIndex !== undefined && toIndex > fromIndex;
}

export function transitionProductionPhase(state: ProductionState, phase: ProductionPhase): void {
    if (!canTransitionProductionPhase(state.phase, phase)) {
        throw new Error(`Invalid production phase transition: ${state.phase} -> ${phase}`);
    }
    state.phase = phase;
}

export function updateProductionProgress(
    state: ProductionState,
    completedFrames: number,
    totalFrames: number,
    fps?: number,
): void {
    if (!Number.isInteger(completedFrames) || !Number.isInteger(totalFrames)
        || completedFrames < 0 || totalFrames < 0 || completedFrames > totalFrames) {
        throw new RangeError('Production frame progress is invalid');
    }
    const fraction = totalFrames === 0 ? 0 : completedFrames / totalFrames;
    state.progress = fps === undefined
        ? { completedFrames, totalFrames, fraction }
        : { completedFrames, totalFrames, fraction, fps };
}

/** Return a detached JSON-compatible snapshot for the automation boundary. */
export function snapshotProductionState(state: ProductionState): ProductionState {
    return structuredClone(state);
}

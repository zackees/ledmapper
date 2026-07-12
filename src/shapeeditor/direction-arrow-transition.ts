import type { DirectionArrowAnchor } from './direction-arrows';

export type { DirectionArrowAnchor } from './direction-arrows';

export type DirectionArrowTransitionPhase = 'idle' | 'settling' | 'crossfading';

export interface DirectionArrowLayer {
    anchors: DirectionArrowAnchor[];
    opacity: number;
}

export interface DirectionArrowTransitionOptions {
    settleMs?: number;
    fadeMs?: number;
}

const DEFAULT_SETTLE_MS = 250;
const DEFAULT_FADE_MS = 200;

function densitySignature(anchors: DirectionArrowAnchor[]): string {
    const counts: number[] = [];
    for (const anchor of anchors) {
        counts[anchor.stripIndex] = (counts[anchor.stripIndex] ?? 0) + 1;
    }
    return counts.join(',');
}

/**
 * Holds the currently displayed arrow layout while interactive zoom is active,
 * then crossfades to the latest adaptive layout after zoom settles.
 *
 * Layers contain logical path anchors rather than canvas coordinates. The
 * renderer reprojects them every frame, so frozen-density arrows stay attached
 * to their LEDs while the camera continues to move.
 */
export class DirectionArrowTransition {
    private readonly settleMs: number;
    private readonly fadeMs: number;
    private baseLayers: DirectionArrowLayer[] = [];
    private targetAnchors: DirectionArrowAnchor[] | null = null;
    private lastZoomAt: number | null = null;
    private fadeStartAt: number | null = null;

    constructor(options: DirectionArrowTransitionOptions = {}) {
        this.settleMs = Math.max(0, options.settleMs ?? DEFAULT_SETTLE_MS);
        this.fadeMs = Math.max(1, options.fadeMs ?? DEFAULT_FADE_MS);
    }

    noteZoom(now: number): void {
        if (this.fadeStartAt !== null && this.targetAnchors) {
            this.baseLayers = this.layersAt(now).filter((layer) => layer.opacity > 0);
            this.targetAnchors = null;
            this.fadeStartAt = null;
        }
        this.lastZoomAt = now;
    }

    update(adaptiveAnchors: DirectionArrowAnchor[], now: number, forceImmediate = false): DirectionArrowLayer[] {
        if (this.baseLayers.length === 0 || forceImmediate) {
            this.baseLayers = [{ anchors: adaptiveAnchors, opacity: 1 }];
            this.targetAnchors = null;
            this.lastZoomAt = null;
            this.fadeStartAt = null;
            return this.copyLayers(this.baseLayers);
        }

        if (this.lastZoomAt === null) {
            this.baseLayers = [{ anchors: adaptiveAnchors, opacity: 1 }];
            return this.copyLayers(this.baseLayers);
        }

        const settleAt = this.lastZoomAt + this.settleMs;
        if (now < settleAt) return this.copyLayers(this.baseLayers);

        if (this.fadeStartAt === null) {
            if (
                this.baseLayers.length === 1
                && densitySignature(this.baseLayers[0]?.anchors ?? []) === densitySignature(adaptiveAnchors)
            ) {
                this.baseLayers = [{ anchors: adaptiveAnchors, opacity: 1 }];
                this.lastZoomAt = null;
                return this.copyLayers(this.baseLayers);
            }
            this.targetAnchors = adaptiveAnchors;
            this.fadeStartAt = settleAt;
        }

        const layers = this.layersAt(now);
        if (now >= this.fadeStartAt + this.fadeMs) {
            this.baseLayers = [{ anchors: this.targetAnchors ?? adaptiveAnchors, opacity: 1 }];
            this.targetAnchors = null;
            this.lastZoomAt = null;
            this.fadeStartAt = null;
            return this.copyLayers(this.baseLayers);
        }
        return layers;
    }

    isActive(): boolean {
        return this.lastZoomAt !== null;
    }

    reset(): void {
        this.baseLayers = [];
        this.targetAnchors = null;
        this.lastZoomAt = null;
        this.fadeStartAt = null;
    }

    getPhase(): DirectionArrowTransitionPhase {
        if (this.fadeStartAt !== null) return 'crossfading';
        if (this.lastZoomAt !== null) return 'settling';
        return 'idle';
    }

    private layersAt(now: number): DirectionArrowLayer[] {
        if (this.fadeStartAt === null || !this.targetAnchors) return this.copyLayers(this.baseLayers);
        const progress = Math.min(1, Math.max(0, (now - this.fadeStartAt) / this.fadeMs));
        return [
            ...this.baseLayers.map((layer) => ({
                anchors: layer.anchors,
                opacity: layer.opacity * (1 - progress),
            })),
            { anchors: this.targetAnchors, opacity: progress },
        ];
    }

    private copyLayers(layers: DirectionArrowLayer[]): DirectionArrowLayer[] {
        return layers.map((layer) => ({ anchors: layer.anchors, opacity: layer.opacity }));
    }
}

import template from './template.html?raw';
import cssUrl from './production.css?url';
import { createLogger } from '../debug-log';
import { download_blob_as_file } from '../common';
import {
    parseProductionQuery,
    ProductionContractError,
    type ProductionConfig,
} from './contract';
import {
    createProductionState,
    snapshotProductionState,
    transitionProductionPhase,
    updateProductionProgress,
    type ProductionInputMetadata,
    type ProductionState,
} from './state';
import { renderProduction } from './production-renderer';

export const css = cssUrl;
export const PRODUCTION_VIDEO_INPUT_SELECTOR = '#production-video-input';
export const PRODUCTION_SCREENMAP_INPUT_SELECTOR = '#production-screenmap-input';

export interface ProductionInput {
    video: File;
    screenmap: File;
    sourceArchiveUrl: string;
}

export interface ProductionElementInput {
    sourceArchiveUrl: string;
}

export interface LmProductionApi {
    readonly apiVersion: 1;
    getState(): ProductionState;
    provideInput(input: ProductionInput): Promise<void>;
    provideInputFromElements(input: ProductionElementInput): Promise<void>;
    start(): Promise<void>;
    cancel(): void;
}

declare global {
    interface Window {
        __lmProduction?: LmProductionApi;
    }
}

const log = createLogger('production');
const TERMINAL_PHASES = new Set(['completed', 'failed', 'cancelled']);

function errorDetails(error: unknown): { code: string; message: string } {
    if (error instanceof ProductionContractError) return { code: error.code, message: error.message };
    const raw = error instanceof Error ? error.message : String(error);
    const code = raw.split(':', 1)[0] ?? 'PRODUCTION_FAILED';
    const safeCodes = new Set([
        'INVALID_SCREENMAP', 'INVALID_VIDEO_INPUT', 'INVALID_SCREENMAP_INPUT',
        'INPUT_FILES_MISSING', 'INPUT_NOT_EXPECTED', 'SOURCE_ARCHIVE_URL_MISMATCH',
        'JOB_NOT_READY', 'VIDEO_DECODE_UNSUPPORTED', 'VIDEO_METADATA_INVALID',
        'MP4_ENCODING_UNSUPPORTED', 'RENDER_FAILED', 'RENDER_INCOMPLETE', 'CANCELLED',
    ]);
    return {
        code: safeCodes.has(code) ? code : 'PRODUCTION_FAILED',
        message: safeCodes.has(code) ? code.replaceAll('_', ' ').toLowerCase() : 'Production failed',
    };
}

function fail(state: ProductionState, error: unknown): void {
    if (TERMINAL_PHASES.has(state.phase)) return;
    const details = errorDetails(error);
    transitionProductionPhase(state, details.code === 'CANCELLED' ? 'cancelled' : 'failed');
    state.error = details.code === 'CANCELLED' ? null : details;
    log.error('failed', details);
}

function isMp4(file: File): boolean {
    return file.name.toLowerCase().endsWith('.mp4') && (file.type === '' || file.type === 'video/mp4');
}

function isJson(file: File): boolean {
    return file.name === 'screenmap.json' && (file.type === '' || file.type === 'application/json');
}

export function init(container: HTMLElement): () => void {
    container.innerHTML = template;
    const phaseElement = container.querySelector<HTMLElement>('#production-phase');
    const progressElement = container.querySelector<HTMLElement>('#production-progress-fill');
    const progressTrack = progressElement?.parentElement;
    const progressLabel = container.querySelector<HTMLElement>('#production-progress-label');
    const configElement = container.querySelector<HTMLElement>('#production-config');
    const artifactsElement = container.querySelector<HTMLElement>('#production-artifacts');
    const errorElement = container.querySelector<HTMLElement>('#production-error');
    const videoInput = container.querySelector<HTMLInputElement>(PRODUCTION_VIDEO_INPUT_SELECTOR);
    const screenmapInput = container.querySelector<HTMLInputElement>(PRODUCTION_SCREENMAP_INPUT_SELECTOR);
    const renderMount = container.querySelector<HTMLElement>('#production-render-mount');
    if (!phaseElement || !progressElement || !progressTrack || !progressLabel || !configElement
        || !artifactsElement || !errorElement || !videoInput || !screenmapInput || !renderMount) {
        throw new Error('Production status page failed to initialize');
    }

    let config: ProductionConfig | null = null;
    let contractError: unknown = null;
    try { config = parseProductionQuery(window.location.search); } catch (error) { contractError = error; }
    const state = createProductionState(config);
    if (contractError) state.error = errorDetails(contractError);
    let video: File | null = null;
    let screenmapText: string | null = null;
    let cancelled = false;
    let destroyed = false;
    let running: Promise<void> | null = null;

    const renderStatus = (): void => {
        phaseElement.textContent = state.phase;
        const percent = Math.round(state.progress.fraction * 100);
        progressElement.style.width = `${String(percent)}%`;
        progressTrack.setAttribute('aria-valuenow', String(percent));
        progressLabel.textContent = `${String(state.progress.completedFrames)} / ${String(state.progress.totalFrames)} frames`;
        configElement.textContent = state.config ? JSON.stringify(state.config, null, 2) : 'Invalid production query';
        artifactsElement.replaceChildren(...state.expectedArtifacts.map((kind) => {
            const item = document.createElement('li');
            item.textContent = `.${kind}`;
            return item;
        }));
        errorElement.hidden = state.error === null;
        errorElement.textContent = state.error ? `${state.error.code}: ${state.error.message}` : '';
    };

    const provideInput = async (input: ProductionInput): Promise<void> => {
        try {
            if (!config || state.phase !== 'awaiting-input') throw new Error('INPUT_NOT_EXPECTED');
            if (input.sourceArchiveUrl !== config.input) throw new Error('SOURCE_ARCHIVE_URL_MISMATCH');
            transitionProductionPhase(state, 'validating-input');
            renderStatus();
            if (!isMp4(input.video)) throw new Error('INVALID_VIDEO_INPUT');
            if (!isJson(input.screenmap)) throw new Error('INVALID_SCREENMAP_INPUT');
            const text = await input.screenmap.text();
            JSON.parse(text);
            const { parseScreenmapMultiStrip } = await import('../common');
            const parsed = parseScreenmapMultiStrip(text);
            if (parsed.totalCount <= 0) throw new Error('INVALID_SCREENMAP');
            if (cancelled || destroyed) throw new Error('CANCELLED');
            video = input.video;
            screenmapText = text;
            const metadata: ProductionInputMetadata = {
                sourceArchiveUrl: input.sourceArchiveUrl,
                videoFilename: input.video.name,
                screenmapFilename: input.screenmap.name,
                videoByteSize: input.video.size,
                screenmapByteSize: input.screenmap.size,
                ledCount: parsed.totalCount,
                stripCount: parsed.strips.length,
            };
            state.inputMetadata = metadata;
            transitionProductionPhase(state, 'ready');
            log.info('input-ready', { video: metadata.videoFilename, screenmap: metadata.screenmapFilename });
        } catch (error) {
            fail(state, error);
            throw error;
        } finally {
            renderStatus();
        }
    };

    const api: LmProductionApi = {
        apiVersion: 1,
        getState: () => snapshotProductionState(state),
        provideInput,
        provideInputFromElements: async ({ sourceArchiveUrl }) => {
            try {
                const selectedVideo = videoInput.files?.[0];
                const selectedScreenmap = screenmapInput.files?.[0];
                if (!selectedVideo || !selectedScreenmap) throw new Error('INPUT_FILES_MISSING');
                await provideInput({ video: selectedVideo, screenmap: selectedScreenmap, sourceArchiveUrl });
            } catch (error) {
                fail(state, error);
                renderStatus();
                throw error;
            }
        },
        start: async () => {
            if (running) return running;
            if (!config || !video || screenmapText === null || state.phase !== 'ready') {
                const error = new Error('JOB_NOT_READY');
                fail(state, error);
                renderStatus();
                throw error;
            }
            transitionProductionPhase(state, 'rendering');
            renderStatus();
            log.info('started', { output: config.output });
            running = (async () => {
                try {
                    const result = await renderProduction({
                        config,
                        video,
                        screenmapText,
                        mount: renderMount,
                        isCancelled: () => cancelled || destroyed,
                        onProgress: (done, total, stage) => {
                            if (stage === 'encoding' && state.phase === 'rendering') transitionProductionPhase(state, 'encoding');
                            updateProductionProgress(state, done, total);
                            renderStatus();
                        },
                    });
                    if (cancelled || destroyed) throw new Error('CANCELLED');
                    if (state.inputMetadata) Object.assign(state.inputMetadata, result.input);
                    state.artifacts = result.artifacts.map(({ kind, filename, mimeType, bytes, frameCount, fps }) => ({
                        kind, filename, mimeType, byteSize: bytes, frameCount, fps,
                    }));
                    if (result.input.frameCount > 0) updateProductionProgress(state, result.input.frameCount, result.input.frameCount, result.input.fps);
                    // Artifact metadata must be visible before downloads begin so
                    // automation can validate every suggested filename.
                    renderStatus();
                    for (const artifact of result.artifacts) download_blob_as_file(artifact.blob, artifact.filename);
                    transitionProductionPhase(state, 'completed');
                    log.info('completed', { artifacts: state.artifacts.map((artifact) => artifact.filename) });
                } catch (error) {
                    fail(state, error);
                } finally {
                    renderStatus();
                }
            })();
            return running;
        },
        cancel: () => {
            if (TERMINAL_PHASES.has(state.phase)) return;
            cancelled = true;
            transitionProductionPhase(state, 'cancelled');
            log.info('cancelled');
            renderStatus();
        },
    };

    window.__lmProduction = api;
    renderStatus();
    log.info(config ? 'awaiting-input' : 'contract-invalid', state.error ?? { version: 1 });

    return () => {
        destroyed = true;
        cancelled = true;
        if (!TERMINAL_PHASES.has(state.phase)) transitionProductionPhase(state, 'cancelled');
        if (window.__lmProduction === api) delete window.__lmProduction;
        videoInput.value = '';
        screenmapInput.value = '';
        renderMount.replaceChildren();
    };
}

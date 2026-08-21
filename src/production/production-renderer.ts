import { parseScreenmapMultiStrip } from '../common';
import { createBlurPipeline } from '../moviemaker/blur-pipeline';
import { extractGatherToRgb } from '../moviemaker/offline-capture-frame';
import { createLedPreview } from '../moviemaker/preview';
import { buildVideoChannelMap, scaleToMaxDimension, transformToCenter } from '../moviemaker/transforms';
import { buildFledArtifact, embedFps } from '../moviemaker/recording';
import { PixelFormat, prependFledHeader } from '../render/rgb-video';
import { dimensionsForAspect } from '../render/canvas-recorder';
import type { ProductionConfig } from './contract';
import { drawProductionFrame, productionOutputDimensions } from './compositor';
import { createMp4CanvasEncoder, type Mp4CanvasEncoder } from './mp4-encoder';
import { createSidecarArtifactUpload, type SidecarProductionTransport } from './transport';
import { IRIS_ATTACK_TAU, IRIS_DIAMETER_GAIN } from '../bloom-utils';
import type { HdrBloomCompositeMode } from '../moviemaker/preview';

export interface ProductionRenderArtifact {
    kind: 'fled' | 'mp4';
    filename: string;
    blob?: Blob;
    mimeType: string;
    bytes: number;
    frameCount: number;
    fps: number;
    sha256?: string;
}

export interface ProductionRenderResult {
    artifacts: ProductionRenderArtifact[];
    input: {
        ledCount: number;
        stripCount: number;
        width: number;
        height: number;
        fps: number;
        frameCount: number;
        hdrBloomVerification?: ReturnType<ReturnType<typeof createLedPreview>['getHdrBloomVerification']>;
    };
}

export interface ProductionRenderOptions {
    config: ProductionConfig;
    video: File;
    screenmapText: string;
    mount: HTMLElement;
    isCancelled: () => boolean;
    onProgress: (done: number, total: number, stage: 'rendering' | 'encoding') => void;
    sidecar?: SidecarProductionTransport;
}

// Full-frame output magnifies the interactive preview considerably. Dense LED
// grids need a tighter envelope so bloom remains a halo rather than a wash.
const PRODUCTION_BLOOM_PROFILE = { floor: 0.15, maxDense: 1.0, maxSparse: 1.6 };
const IRIS_PREROLL_TIME_CONSTANTS = 4;

function productionHdrCompositeMode(): HdrBloomCompositeMode {
    if (!import.meta.env.DEV) return 'gpu-full';
    const override: unknown = Reflect.get(import.meta.env, 'VITE_HDR_BLOOM_COMPOSITE_MODE');
    return override === 'cpu-full' || override === 'cpu-1024' || override === 'verify-full'
        ? override
        : 'gpu-full';
}

/** Unrecorded frames needed to settle the opening exposure by >98%. */
export function productionIrisPrerollFrames(outputFps: number): number {
    return Math.ceil(IRIS_PREROLL_TIME_CONSTANTS * IRIS_ATTACK_TAU * Math.max(outputFps, 1));
}

/** Constant-rate timestamps covered by one decoded source sample. */
export function scheduleProductionFrames(timestamp: number, duration: number, nextTimestamp: number, outputFps: number): { timestamps: number[]; nextTimestamp: number } {
    const frameDuration = 1 / outputFps;
    const endTimestamp = timestamp + duration;
    const timestamps: number[] = [];
    let next = nextTimestamp;
    while (next < endTimestamp - frameDuration * 1e-6) {
        timestamps.push(next);
        next += frameDuration;
    }
    return { timestamps, nextTimestamp: next };
}

function sourceName(file: File): string {
    const stem = file.name.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '');
    return stem || 'mapping';
}

function concatFrames(frames: Uint8Array[]): Uint8Array {
    const bytes = frames.reduce((sum, frame) => sum + frame.byteLength, 0);
    const output = new Uint8Array(bytes);
    let offset = 0;
    for (const frame of frames) { output.set(frame, offset); offset += frame.byteLength; }
    return output;
}

export async function renderProduction(options: ProductionRenderOptions): Promise<ProductionRenderResult> {
    const { config, video, screenmapText, mount, isCancelled, onProgress, sidecar } = options;
    const parsed = parseScreenmapMultiStrip(screenmapText);
    if (parsed.totalCount <= 0) throw new Error('INVALID_SCREENMAP');

    const mb = await import('mediabunny');
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(video) });
    let pipeline: ReturnType<typeof createBlurPipeline> | null = null;
    let preview: ReturnType<typeof createLedPreview> | null = null;
    let encoder: Mp4CanvasEncoder | null = null;
    try {
        const track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) throw new Error('VIDEO_DECODE_UNSUPPORTED');
        const nativeWidth = await track.getDisplayWidth();
        const nativeHeight = await track.getDisplayHeight();
        const { width, height } = scaleToMaxDimension(nativeWidth, nativeHeight, config.maxResolution);
        const stats = await track.computePacketStats();
        const total = stats.packetCount;
        const fps = stats.averagePacketRate;
        if (!Number.isFinite(fps) || fps <= 0 || total <= 0) throw new Error('VIDEO_METADATA_INVALID');
        const outputFps = config.outputFps || fps;

        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.className = 'production-render-canvas';
        mount.append(sourceCanvas);
        pipeline = createBlurPipeline({ canvas: sourceCanvas, initialUniforms: { blurRadius: config.blurRadius, sigma: config.blurSigma } });
        pipeline.setupForResolution(width, height);
        const points = transformToCenter(parsed.allPoints, width, height);
        pipeline.setSamplePoints(points, width, height);
        // Panel rotation is presentation-only. Keep gather coordinates in the
        // source's native orientation so the image remains vertically aligned
        // when its physical LED panel is shown as a diamond. `rotation` is an
        // explicit source-image rotation only.
        pipeline.setSampleTransform(
            config.rotation + config.panelRotation,
            config.zoom,
            config.translateX * width,
            config.translateY * height,
        );
        pipeline.updateUniforms({
            blurRadius: config.blurRadius,
            sigma: config.blurSigma,
            brightness: config.brightness / 100,
            maxBrightness: config.limitBrightness ? config.maxBrightness / 100 : 1,
            gamma: config.gamma,
        });
        const channelMap = buildVideoChannelMap(parsed.strips, parsed.totalCount);

        const wantsMp4 = config.output !== 'fled';
        const wantsFled = config.output !== 'mp4';
        const outputDimensions = productionOutputDimensions(
            dimensionsForAspect(config.aspect),
            config.videoMode,
        );
        const compositionCanvas = document.createElement('canvas');
        compositionCanvas.width = outputDimensions.width;
        compositionCanvas.height = outputDimensions.height;
        const compositionContext = compositionCanvas.getContext('2d');
        if (wantsMp4 && !compositionContext) throw new Error('RENDER_FAILED');

        let previewMount: HTMLElement | null = null;
        if (wantsMp4 && !config.hidden) {
            previewMount = document.createElement('div');
            previewMount.className = 'production-preview-mount';
            mount.append(previewMount);
            preview = createLedPreview({
                parent: previewMount,
                side: Math.min(outputDimensions.width, outputDimensions.height),
                // True offline 2x AA: 2048 WebGL/bloom backing buffer, reduced
                // once into the native 1024 mapped-video encoder canvas.
                maxBufferSize: 2048,
                bloomProfile: PRODUCTION_BLOOM_PROFILE,
                // At native 1024 output the modest geometry-gated diameter
                // iris no longer crosses a 1024->1080 resampling lattice.
                bloomDiameterGain: IRIS_DIAMETER_GAIN,
                bloomUseBlowoutRisk: true,
                enableHdrBloom: true,
                hdrBloomCompositeMode: productionHdrCompositeMode(),
                hdrBloomStrategy: config.bloomStrategy,
            });
            preview.setAutoBloom(config.autoBloom);
            preview.setManualBloomStrength(config.bloomStrength);
        }
        const fledUpload = wantsFled && sidecar ? createSidecarArtifactUpload(sidecar, 'fled') : null;
        const mp4Upload = wantsMp4 && sidecar ? createSidecarArtifactUpload(sidecar, 'mp4') : null;
        const fledWriter = fledUpload?.writable.getWriter();
        if (fledWriter) await fledWriter.write(prependFledHeader(new Uint8Array(), embedFps(screenmapText, fps), PixelFormat.rgb8));
        if (wantsMp4) encoder = await createMp4CanvasEncoder({ canvas: compositionCanvas, ...outputDimensions, writable: mp4Upload?.writable });

        const frames: Uint8Array[] = [];
        let done = 0;
        let mp4FrameCount = 0;
        let irisSettled = false;
        // MP4 cadence is scheduled independently of decoded-source cadence.
        // This makes outputFps=60 exact for 25, 30, 50, or variable-rate input.
        let nextMp4Timestamp = 0;
        const sink = new mb.VideoSampleSink(track);
        for await (const sample of sink.samples()) {
            let frame: VideoFrame | null = null;
            try {
                if (isCancelled()) throw new Error('CANCELLED');
                frame = sample.toVideoFrame();
                const gather = await pipeline.captureFrameSample(frame);
                if (!gather) throw new Error('RENDER_FAILED');
                const displaySample = extractGatherToRgb(gather);
                if (wantsFled) {
                    const rgb = extractGatherToRgb(gather, channelMap).rgbPts;
                    if (fledWriter) await fledWriter.write(rgb); else frames.push(rgb);
                }
                if (wantsMp4 && compositionContext && encoder) {
                    const timestamp = Number.isFinite(sample.timestamp) && sample.timestamp >= 0 ? sample.timestamp : done / fps;
                    const duration = Number.isFinite(sample.duration) && sample.duration > 0 ? sample.duration : 1 / fps;
                    const panelRotation = config.panelRotation || (config.previewRotate ? config.rotation : 0);
                    // The offline loop runs faster than wall clock, so use
                    // media time. Before encoding the first visible frame,
                    // feed the same sample through an unrecorded pre-roll to
                    // settle bloom and the global iris at its proper level.
                    if (!irisSettled) {
                        const intervalMs = 1000 / Math.max(outputFps, 1);
                        for (let preRoll = productionIrisPrerollFrames(outputFps); preRoll > 0; preRoll--) {
                            preview?.render(
                                points, panelRotation, displaySample, null, [], [],
                                timestamp * 1000 - preRoll * intervalMs,
                            );
                        }
                        irisSettled = true;
                    }
                    // Sampling and output layout are independent: a diamond
                    // panel can show an upright source video without rotating
                    // its capture coordinates.
                    preview?.render(points, panelRotation, displaySample, null, [], [], timestamp * 1000);
                    drawProductionFrame({
                        context: compositionContext,
                        source: sourceCanvas,
                        preview: preview?.domElement ?? null,
                        output: outputDimensions,
                        hidden: config.hidden,
                        videoMode: config.videoMode,
                    });
                    if (config.outputFps === 0) {
                        await encoder.addFrame(timestamp, duration);
                        mp4FrameCount++;
                    } else {
                        // Hold each mapped frame until the next decoded frame;
                        // this is deliberate frame repetition, not interpolation.
                        if (done === 0) nextMp4Timestamp = timestamp;
                        const schedule = scheduleProductionFrames(timestamp, duration, nextMp4Timestamp, outputFps);
                        for (const outputTimestamp of schedule.timestamps) {
                            await encoder.addFrame(outputTimestamp, 1 / outputFps);
                            mp4FrameCount++;
                        }
                        nextMp4Timestamp = schedule.nextTimestamp;
                    }
                }
                done++;
                onProgress(done, total, 'rendering');
            } finally {
                frame?.close();
                sample.close();
            }
        }
        if (done !== total) throw new Error(`RENDER_INCOMPLETE:${String(done)}:${String(total)}`);
        const hdrVerification = preview?.getHdrBloomVerification();

        const artifacts: ProductionRenderArtifact[] = [];
        const stem = sourceName(video);
        if (wantsFled) {
            if (fledWriter && fledUpload) {
                await fledWriter.close();
                const uploaded = await fledUpload.complete();
                artifacts.push({ kind: 'fled', filename: `${stem}.fled`, mimeType: 'application/vnd.fastled.video', bytes: uploaded.byteSize, sha256: uploaded.sha256, frameCount: done, fps });
            } else {
            const fled = buildFledArtifact(concatFrames(frames), {
                frameCount: done,
                fps,
                ledCount: parsed.totalCount,
                screenmapJson: screenmapText,
            });
            const fledBytes = new Uint8Array(fled.bytes.byteLength);
            fledBytes.set(fled.bytes);
            const blob = new Blob([fledBytes.buffer], { type: fled.mimeType });
            artifacts.push({ kind: 'fled', filename: `${stem}.fled`, blob, mimeType: fled.mimeType, bytes: blob.size, frameCount: done, fps });
            }
        }
        if (encoder) {
            onProgress(done, total, 'encoding');
            const blob = await encoder.finalize();
            encoder = null;
            if (mp4Upload) {
                const uploaded = await mp4Upload.complete();
                artifacts.push({ kind: 'mp4', filename: `${stem}.mp4`, mimeType: 'video/mp4', bytes: uploaded.byteSize, sha256: uploaded.sha256, frameCount: mp4FrameCount, fps: outputFps });
            } else if (blob) artifacts.push({ kind: 'mp4', filename: `${stem}.mp4`, blob, mimeType: 'video/mp4', bytes: blob.size, frameCount: mp4FrameCount, fps: outputFps });
        }
        return {
            artifacts,
            input: {
                ledCount: parsed.totalCount,
                stripCount: parsed.strips.length,
                width,
                height,
                fps,
                frameCount: done,
                ...(hdrVerification ? { hdrBloomVerification: hdrVerification } : {}),
            },
        };
    } finally {
        if (encoder) await encoder.cancel().catch(() => undefined);
        preview?.dispose();
        pipeline?.dispose();
        input.dispose();
    }
}

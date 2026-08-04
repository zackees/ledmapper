import { parseScreenmapMultiStrip } from '../common';
import { createBlurPipeline } from '../moviemaker/blur-pipeline';
import { extractGatherToRgb } from '../moviemaker/offline-capture-frame';
import { createLedPreview } from '../moviemaker/preview';
import { buildVideoChannelMap, scaleToMaxDimension, transformToCenter } from '../moviemaker/transforms';
import { buildFledArtifact, embedFps } from '../moviemaker/recording';
import { PixelFormat, prependFledHeader } from '../render/rgb-video';
import { dimensionsForAspect } from '../render/canvas-recorder';
import type { ProductionConfig } from './contract';
import { drawProductionFrame } from './compositor';
import { createMp4CanvasEncoder, type Mp4CanvasEncoder } from './mp4-encoder';
import { createSidecarArtifactUpload, type SidecarProductionTransport } from './transport';

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
    input: { ledCount: number; stripCount: number; width: number; height: number; fps: number; frameCount: number };
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

        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.className = 'production-render-canvas';
        mount.append(sourceCanvas);
        pipeline = createBlurPipeline({ canvas: sourceCanvas, initialUniforms: { blurRadius: config.blurRadius, sigma: config.blurSigma } });
        pipeline.setupForResolution(width, height);
        const points = transformToCenter(parsed.allPoints, width, height);
        pipeline.setSamplePoints(points, width, height);
        pipeline.setSampleTransform(config.rotation, config.zoom, config.translateX * width, config.translateY * height);
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
        const outputDimensions = dimensionsForAspect(config.aspect);
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
            preview = createLedPreview({ parent: previewMount, side: Math.min(outputDimensions.width, outputDimensions.height) });
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
                    preview?.render(points, config.previewRotate ? config.rotation : 0, displaySample, null);
                    drawProductionFrame({
                        context: compositionContext,
                        source: sourceCanvas,
                        preview: preview?.domElement ?? null,
                        output: outputDimensions,
                        hidden: config.hidden,
                    });
                    const timestamp = Number.isFinite(sample.timestamp) && sample.timestamp >= 0 ? sample.timestamp : done / fps;
                    const duration = Number.isFinite(sample.duration) && sample.duration > 0 ? sample.duration : 1 / fps;
                    await encoder.addFrame(timestamp, duration);
                }
                done++;
                onProgress(done, total, 'rendering');
            } finally {
                frame?.close();
                sample.close();
            }
        }
        if (done !== total) throw new Error(`RENDER_INCOMPLETE:${String(done)}:${String(total)}`);

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
                artifacts.push({ kind: 'mp4', filename: `${stem}.mp4`, mimeType: 'video/mp4', bytes: uploaded.byteSize, sha256: uploaded.sha256, frameCount: done, fps });
            } else if (blob) artifacts.push({ kind: 'mp4', filename: `${stem}.mp4`, blob, mimeType: 'video/mp4', bytes: blob.size, frameCount: done, fps });
        }
        return {
            artifacts,
            input: { ledCount: parsed.totalCount, stripCount: parsed.strips.length, width, height, fps, frameCount: done },
        };
    } finally {
        if (encoder) await encoder.cancel().catch(() => undefined);
        preview?.dispose();
        pipeline?.dispose();
        input.dispose();
    }
}

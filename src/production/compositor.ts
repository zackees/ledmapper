import type { AspectDimensions } from '../render/canvas-recorder';
import type { ProductionVideoMode } from './contract';

export interface DrawRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Fit an image inside a box without cropping or stretching. */
export function containRect(
    sourceWidth: number,
    sourceHeight: number,
    box: DrawRect,
): DrawRect {
    if (sourceWidth <= 0 || sourceHeight <= 0 || box.width <= 0 || box.height <= 0) {
        return { x: box.x, y: box.y, width: 0, height: 0 };
    }
    const scale = Math.min(box.width / sourceWidth, box.height / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return {
        x: box.x + (box.width - width) / 2,
        y: box.y + (box.height - height) / 2,
        width,
        height,
    };
}

export interface ProductionComposition {
    source: DrawRect | null;
    preview: DrawRect | null;
}

/**
 * Mapped-only output stays native to the deterministic 1024px WebGL preview.
 * A 1080 canvas would resample the 64x64 lattice by 1.0546875x, producing
 * diagonal beat/aliasing lines and uneven circles.
 */
export function productionOutputDimensions(
    requested: AspectDimensions,
    videoMode: ProductionVideoMode,
): AspectDimensions {
    return videoMode === 'mapped-led' ? { width: 1024, height: 1024 } : requested;
}

/** Compute source/preview panels for deterministic production video. */
export function productionComposition(
    output: AspectDimensions,
    sourceWidth: number,
    sourceHeight: number,
    hidden: boolean,
    videoMode: ProductionVideoMode = 'side-by-side',
): ProductionComposition {
    const full = { x: 0, y: 0, width: output.width, height: output.height };
    if (hidden) {
        return { source: containRect(sourceWidth, sourceHeight, full), preview: null };
    }
    if (videoMode === 'mapped-led') {
        return { source: null, preview: containRect(1, 1, full) };
    }
    const leftWidth = Math.floor(output.width / 2);
    const sourceBox = { x: 0, y: 0, width: leftWidth, height: output.height };
    const previewBox = {
        x: leftWidth,
        y: 0,
        width: output.width - leftWidth,
        height: output.height,
    };
    return {
        source: containRect(sourceWidth, sourceHeight, sourceBox),
        preview: containRect(1, 1, previewBox),
    };
}

export function drawProductionFrame({
    context,
    source,
    preview,
    output,
    hidden,
    videoMode,
}: {
    context: CanvasRenderingContext2D;
    source: CanvasImageSource;
    preview: CanvasImageSource | null;
    output: AspectDimensions;
    hidden: boolean;
    videoMode: ProductionVideoMode;
}): void {
    context.fillStyle = 'black';
    context.fillRect(0, 0, output.width, output.height);
    const sourceWidth = 'videoWidth' in source
        ? source.videoWidth
        : 'width' in source ? Number(source.width) : output.width;
    const sourceHeight = 'videoHeight' in source
        ? source.videoHeight
        : 'height' in source ? Number(source.height) : output.height;
    const layout = productionComposition(output, sourceWidth, sourceHeight, hidden, videoMode);
    if (layout.source) context.drawImage(source, layout.source.x, layout.source.y, layout.source.width, layout.source.height);
    if (preview && layout.preview) {
        // Offline mapped production renders its WebGL preview at 2x and makes
        // exactly one high-quality reduction into the 1024px encoder canvas.
        // This smooths circle edges and diameter animation without introducing
        // the old 1024->1080 non-integer upscale pattern.
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(preview, layout.preview.x, layout.preview.y, layout.preview.width, layout.preview.height);
    }
}

import type { AspectDimensions } from '../render/canvas-recorder';

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
    source: DrawRect;
    preview: DrawRect | null;
}

/** Compute source/preview panels for deterministic production video. */
export function productionComposition(
    output: AspectDimensions,
    sourceWidth: number,
    sourceHeight: number,
    hidden: boolean,
): ProductionComposition {
    const full = { x: 0, y: 0, width: output.width, height: output.height };
    if (hidden) {
        return { source: containRect(sourceWidth, sourceHeight, full), preview: null };
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
}: {
    context: CanvasRenderingContext2D;
    source: CanvasImageSource;
    preview: CanvasImageSource | null;
    output: AspectDimensions;
    hidden: boolean;
}): void {
    context.fillStyle = 'black';
    context.fillRect(0, 0, output.width, output.height);
    const sourceWidth = 'videoWidth' in source
        ? source.videoWidth
        : 'width' in source ? Number(source.width) : output.width;
    const sourceHeight = 'videoHeight' in source
        ? source.videoHeight
        : 'height' in source ? Number(source.height) : output.height;
    const layout = productionComposition(output, sourceWidth, sourceHeight, hidden);
    context.drawImage(source, layout.source.x, layout.source.y, layout.source.width, layout.source.height);
    if (preview && layout.preview) {
        context.drawImage(preview, layout.preview.x, layout.preview.y, layout.preview.width, layout.preview.height);
    }
}

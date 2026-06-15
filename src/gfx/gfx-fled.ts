/**
 * createGfxFromFled — Mode B: package owns the screenmap and colors.
 *
 * The .fled container is self-describing: header + embedded screenmap
 * + raw payload. We parse it, build a renderer over the embedded
 * screenmap, wire up a `Player`, and return both. The player drives
 * `pushFrame` from its own RAF loop.
 */

import { parseRgbFrames } from '../render/rgb-video';
import { createGfx } from './gfx-core';
import { createPlayer } from './player';
import type { CreateGfxFromFledOptions, GfxWithPlayer } from './types';
import type { ScreenmapJson } from '../types/domain';
import { parse_screenmap_data_json } from '../common';

async function toUint8Array(input: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    return new Uint8Array(await input.arrayBuffer());
}

export async function createGfxFromFled(opts: CreateGfxFromFledOptions): Promise<GfxWithPlayer> {
    const bytes = await toUint8Array(opts.fled);
    // We need the LED count to slice frames; the embedded JSON gives it
    // to us before we instantiate the renderer.
    const firstParse = parseRgbFrames(bytes, 1);
    if (!firstParse.isFled || firstParse.embeddedJson === null) {
        throw new Error('createGfxFromFled: input is not a FLED-formatted file');
    }
    const screenmapJson = JSON.parse(firstParse.embeddedJson) as ScreenmapJson;
    const ledCount = parse_screenmap_data_json(screenmapJson).length;
    if (ledCount === 0) {
        throw new Error('createGfxFromFled: embedded screenmap has zero points');
    }
    const parsed = parseRgbFrames(bytes, ledCount);
    if (parsed.frames.length === 0) {
        throw new Error('createGfxFromFled: no frames in payload (notMultiple=' + String(parsed.notMultiple) + ')');
    }

    const gfx = createGfx({
        screenmap: screenmapJson,
        parent: opts.parent,
        ...(opts.paneSize !== undefined ? { paneSize: opts.paneSize } : {}),
        ...(opts.renderPx !== undefined ? { renderPx: opts.renderPx } : {}),
        ...(opts.bloom !== undefined ? { bloom: opts.bloom } : {}),
        ...(opts.diameter !== undefined ? { diameter: opts.diameter } : {}),
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });

    const player = createPlayer({
        frames: parsed.frames,
        fps: opts.fps ?? 30,
        autoplay: opts.autoplay ?? true,
        pushFrame: (rgb) => { gfx.pushFrame(rgb); },
    });

    const gfxWithPlayer: GfxWithPlayer = {
        canvas: gfx.canvas,
        wrapper: gfx.wrapper,
        get screenmap() { return gfx.screenmap; },
        pushFrame: (rgb: Uint8Array) => { gfx.pushFrame(rgb); },
        setBloom: (cfg) => { gfx.setBloom(cfg); },
        setScreenmap: (map: unknown) => { gfx.setScreenmap(map); },
        getStats: () => gfx.getStats(),
        dispose() {
            player.pause();
            player.unmountControls();
            gfx.dispose();
        },
        player,
        frames: parsed.frames,
    };
    return gfxWithPlayer;
}

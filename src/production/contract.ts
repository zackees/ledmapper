import {
    DEFAULT_HDR_BLOOM_STRATEGY,
    HDR_BLOOM_STRATEGY_NAMES,
    type HdrBloomStrategyName,
} from '../moviemaker/hdr-bloom-strategies';

export const PRODUCTION_CONTRACT_VERSION = 1 as const;
export const MAX_PRODUCTION_QUERY_LENGTH = 8_192;
export const MAX_PRODUCTION_INPUT_URL_LENGTH = 4_096;

export type ProductionOutput = 'fled' | 'mp4' | 'both';
export type ProductionAspect = 'square' | 'portrait' | 'landscape';
/** Visual layout used by an MP4 production render. */
export type ProductionVideoMode = 'side-by-side' | 'mapped-led';
/** `0` preserves source timing; explicit values control MP4 cadence. */
export type ProductionOutputFps = 0 | 30 | 60;

export interface ProductionConfig {
    v: 1;
    input: string;
    output: ProductionOutput;
    rotation: number;
    /** Visual rotation of the mapped LED panel in the output composition. */
    panelRotation: number;
    zoom: number;
    translateX: number;
    translateY: number;
    blurRadius: number;
    blurSigma: number;
    brightness: number;
    gamma: number;
    limitBrightness: boolean;
    maxBrightness: number;
    maxResolution: 0 | 240 | 360 | 480 | 720 | 960;
    autoBloom: boolean;
    bloomStrength: number;
    /** Which HDR bloom composite algorithm to render with. */
    bloomStrategy: HdrBloomStrategyName;
    previewRotate: boolean;
    aspect: ProductionAspect;
    videoMode: ProductionVideoMode;
    outputFps: ProductionOutputFps;
    /** Legacy compatibility flag; prefer videoMode=mapped-led for an LED-only MP4. */
    hidden: boolean;
}

export type ProductionContractErrorCode =
    | 'QUERY_TOO_LONG'
    | 'DUPLICATE_PARAMETER'
    | 'UNKNOWN_PARAMETER'
    | 'MISSING_PARAMETER'
    | 'UNSUPPORTED_VERSION'
    | 'INVALID_ENUM'
    | 'INVALID_BOOLEAN'
    | 'INVALID_NUMBER'
    | 'NUMBER_OUT_OF_RANGE'
    | 'INVALID_INPUT_URL'
    | 'INPUT_URL_TOO_LONG'
    | 'INPUT_URL_CREDENTIALS';

export class ProductionContractError extends Error {
    readonly code: ProductionContractErrorCode;
    readonly parameter?: string;

    constructor(code: ProductionContractErrorCode, message: string, parameter?: string) {
        super(message);
        this.name = 'ProductionContractError';
        this.code = code;
        if (parameter !== undefined) this.parameter = parameter;
    }
}

const ALLOWED_KEYS = new Set([
    'v', 'input', 'output', 'rotation', 'panelRotation', 'zoom', 'translateX', 'translateY',
    'blurRadius', 'blurSigma', 'brightness', 'gamma', 'limitBrightness',
    'maxBrightness', 'maxResolution', 'autoBloom', 'bloomStrength',
    'previewRotate', 'aspect', 'videoMode', 'outputFps', 'hidden', 'bloomStrategy',
]);

function required(params: URLSearchParams, name: string): string {
    const value = params.get(name);
    if (value === null || value === '') {
        throw new ProductionContractError('MISSING_PARAMETER', `Required parameter '${name}' is missing`, name);
    }
    return value;
}

function strictNumber(params: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
    const raw = params.get(name);
    if (raw === null) return fallback;
    // Number() accepts whitespace and hexadecimal, and parseFloat() accepts partial
    // numbers. Production URLs intentionally accept decimal notation only.
    if (raw === '' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
        throw new ProductionContractError('INVALID_NUMBER', `Parameter '${name}' must be a finite decimal number`, name);
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new ProductionContractError('INVALID_NUMBER', `Parameter '${name}' must be a finite decimal number`, name);
    }
    if (value < min || value > max) {
        throw new ProductionContractError('NUMBER_OUT_OF_RANGE', `Parameter '${name}' must be between ${String(min)} and ${String(max)}`, name);
    }
    return Object.is(value, -0) ? 0 : value;
}

function strictBoolean(params: URLSearchParams, name: string, fallback: boolean): boolean {
    const raw = params.get(name);
    if (raw === null) return fallback;
    if (raw === '0') return false;
    if (raw === '1') return true;
    throw new ProductionContractError('INVALID_BOOLEAN', `Parameter '${name}' must be 0 or 1`, name);
}

function strictEnum<T extends string>(params: URLSearchParams, name: string, values: readonly T[], fallback?: T): T {
    const raw = fallback === undefined ? required(params, name) : (params.get(name) ?? fallback);
    if ((values as readonly string[]).includes(raw)) return raw as T;
    throw new ProductionContractError('INVALID_ENUM', `Parameter '${name}' has an unsupported value`, name);
}

function parseInputUrl(raw: string): string {
    if (raw.length > MAX_PRODUCTION_INPUT_URL_LENGTH) {
        throw new ProductionContractError('INPUT_URL_TOO_LONG', 'Input URL is too long', 'input');
    }
    let url: URL;
    try { url = new URL(raw); } catch {
        throw new ProductionContractError('INVALID_INPUT_URL', 'Input must be an absolute HTTP(S) URL', 'input');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new ProductionContractError('INVALID_INPUT_URL', 'Input must be an absolute HTTP(S) URL', 'input');
    }
    if (url.username !== '' || url.password !== '') {
        throw new ProductionContractError('INPUT_URL_CREDENTIALS', 'Input URL must not contain credentials', 'input');
    }
    return url.href;
}

/** Parse and normalize the strict v1 production query contract. */
export function parseProductionQuery(search: string): ProductionConfig {
    if (search.length > MAX_PRODUCTION_QUERY_LENGTH) {
        throw new ProductionContractError('QUERY_TOO_LONG', 'Production query is too long');
    }
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const seen = new Set<string>();
    for (const [key] of params) {
        if (!ALLOWED_KEYS.has(key)) {
            throw new ProductionContractError('UNKNOWN_PARAMETER', `Unknown parameter '${key}'`, key);
        }
        if (seen.has(key)) {
            throw new ProductionContractError('DUPLICATE_PARAMETER', `Parameter '${key}' may only appear once`, key);
        }
        seen.add(key);
    }

    const version = required(params, 'v');
    if (version !== '1') {
        throw new ProductionContractError('UNSUPPORTED_VERSION', 'Only production contract v1 is supported', 'v');
    }
    const maxResolution = strictNumber(params, 'maxResolution', 480, 0, 960);
    if (![0, 240, 360, 480, 720, 960].includes(maxResolution)) {
        throw new ProductionContractError('INVALID_ENUM', "Parameter 'maxResolution' has an unsupported value", 'maxResolution');
    }

    return {
        v: PRODUCTION_CONTRACT_VERSION,
        input: parseInputUrl(required(params, 'input')),
        output: strictEnum(params, 'output', ['fled', 'mp4', 'both']),
        rotation: strictNumber(params, 'rotation', 0, -180, 180),
        panelRotation: strictNumber(params, 'panelRotation', 0, -180, 180),
        zoom: strictNumber(params, 'zoom', 1, 0.15, 3),
        translateX: strictNumber(params, 'translateX', 0.5, 0, 1),
        translateY: strictNumber(params, 'translateY', 0.5, 0, 1),
        blurRadius: strictNumber(params, 'blurRadius', 3, 0, 100),
        blurSigma: strictNumber(params, 'blurSigma', 3, 0, 100),
        brightness: strictNumber(params, 'brightness', 100, 0, 100),
        gamma: strictNumber(params, 'gamma', 1, 0.1, 10),
        limitBrightness: strictBoolean(params, 'limitBrightness', false),
        maxBrightness: strictNumber(params, 'maxBrightness', 50, 1, 100),
        maxResolution: maxResolution as ProductionConfig['maxResolution'],
        autoBloom: strictBoolean(params, 'autoBloom', true),
        bloomStrength: strictNumber(params, 'bloomStrength', 2.475, 0.3, 9),
        bloomStrategy: strictEnum(
            params,
            'bloomStrategy',
            HDR_BLOOM_STRATEGY_NAMES,
            DEFAULT_HDR_BLOOM_STRATEGY,
        ),
        previewRotate: strictBoolean(params, 'previewRotate', false),
        aspect: strictEnum(params, 'aspect', ['square', 'portrait', 'landscape'], 'square'),
        videoMode: strictEnum(params, 'videoMode', ['side-by-side', 'mapped-led'], 'side-by-side'),
        outputFps: strictEnum(params, 'outputFps', ['source', '30', '60'], 'source') === 'source'
            ? 0
            : Number(params.get('outputFps')) as ProductionOutputFps,
        hidden: strictBoolean(params, 'hidden', false),
    };
}

/** Resolve URL-normalized translation only after render dimensions are known. */
export function resolveProductionTranslation(
    config: Pick<ProductionConfig, 'translateX' | 'translateY'>,
    width: number,
    height: number,
): { x: number; y: number } {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new RangeError('Render dimensions must be positive finite numbers');
    }
    return { x: config.translateX * width, y: config.translateY * height };
}

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_PRODUCTION_QUERY_LENGTH,
    ProductionContractError,
    parseProductionQuery,
    resolveProductionTranslation,
} from '../../src/production/contract';

const REQUIRED = 'v=1&input=https%3A%2F%2Fexample.com%2Fjob.zip&output=both';

function contractError(search: string): ProductionContractError {
    try { parseProductionQuery(search); } catch (error) {
        assert.ok(error instanceof ProductionContractError);
        return error;
    }
    assert.fail('Expected contract parser to throw');
}

describe('production v1 query contract', () => {
    void test('normalizes required values and moviemaker defaults', () => {
        assert.deepEqual(parseProductionQuery(REQUIRED), {
            v: 1,
            input: 'https://example.com/job.zip',
            output: 'both',
            rotation: 0,
            panelRotation: 0,
            zoom: 1,
            translateX: 0.5,
            translateY: 0.5,
            blurRadius: 3,
            blurSigma: 3,
            brightness: 100,
            gamma: 1,
            limitBrightness: false,
            maxBrightness: 50,
            maxResolution: 480,
            autoBloom: true,
            bloomStrength: 2.475,
            bloomStrategy: 'acrylic-pane',
            bloomFrequencyMode: 'auto',
            bloomFrequencyBlend: null,
            previewRotate: false,
            aspect: 'square',
            videoMode: 'side-by-side',
            outputFps: 0,
            hidden: false,
        });
    });

    void test('accepts inclusive boundaries and strict booleans', () => {
        const config = parseProductionQuery(`${REQUIRED}&rotation=-180&panelRotation=-45&zoom=3&translateX=0&translateY=1&blurRadius=0&blurSigma=100&brightness=0&gamma=10&limitBrightness=1&maxBrightness=1&maxResolution=0&autoBloom=0&bloomStrength=.3&previewRotate=1&aspect=portrait&videoMode=mapped-led&outputFps=60&hidden=1`);
        assert.equal(config.rotation, -180);
        assert.equal(config.panelRotation, -45);
        assert.equal(config.zoom, 3);
        assert.equal(config.translateX, 0);
        assert.equal(config.translateY, 1);
        assert.equal(config.limitBrightness, true);
        assert.equal(config.maxResolution, 0);
        assert.equal(config.autoBloom, false);
        assert.equal(config.videoMode, 'mapped-led');
        assert.equal(config.outputFps, 60);
        assert.equal(config.hidden, true);
    });

    void test('selects an HDR bloom strategy by name', () => {
        assert.equal(
            parseProductionQuery(`${REQUIRED}&bloomStrategy=white-core-chroma`).bloomStrategy,
            'white-core-chroma',
        );
        assert.equal(
            parseProductionQuery(`${REQUIRED}&bloomStrategy=chroma-shoulder`).bloomStrategy,
            'chroma-shoulder',
        );
    });

    void test('accepts deterministic bloom-frequency evaluator overrides', () => {
        const endpoint = parseProductionQuery(`${REQUIRED}&bloomFrequencyMode=high`);
        assert.equal(endpoint.bloomFrequencyMode, 'high');
        assert.equal(endpoint.bloomFrequencyBlend, null);
        const curve = parseProductionQuery(`${REQUIRED}&bloomFrequencyBlend=.375`);
        assert.equal(curve.bloomFrequencyMode, 'auto');
        assert.equal(curve.bloomFrequencyBlend, 0.375);
        assert.equal(contractError(`${REQUIRED}&bloomFrequencyMode=nope`).code, 'INVALID_ENUM');
        assert.equal(contractError(`${REQUIRED}&bloomFrequencyBlend=1.01`).code, 'NUMBER_OUT_OF_RANGE');
    });

    void test('rejects frequency overrides for strategies that do not consume them', () => {
        assert.equal(
            contractError(`${REQUIRED}&bloomStrategy=white-core-chroma&bloomFrequencyMode=high`).code,
            'INVALID_COMBINATION',
        );
        assert.equal(
            contractError(`${REQUIRED}&bloomStrategy=chroma-shoulder&bloomFrequencyBlend=.5`).code,
            'INVALID_COMBINATION',
        );
        assert.equal(
            parseProductionQuery(`${REQUIRED}&bloomStrategy=white-core-chroma`).bloomFrequencyMode,
            'auto',
        );
    });

    void test('rejects missing, duplicate, and unknown parameters', () => {
        assert.equal(contractError('input=https://example.com/a.zip&output=fled').code, 'MISSING_PARAMETER');
        assert.equal(contractError(`${REQUIRED}&output=fled`).code, 'DUPLICATE_PARAMETER');
        assert.equal(contractError(`${REQUIRED}&extra=1`).code, 'UNKNOWN_PARAMETER');
    });

    void test('rejects unsupported versions and enums', () => {
        assert.equal(contractError(REQUIRED.replace('v=1', 'v=2')).code, 'UNSUPPORTED_VERSION');
        assert.equal(contractError(REQUIRED.replace('output=both', 'output=webm')).code, 'INVALID_ENUM');
        assert.equal(contractError(`${REQUIRED}&maxResolution=500`).code, 'INVALID_ENUM');
        assert.equal(contractError(`${REQUIRED}&videoMode=picture-in-picture`).code, 'INVALID_ENUM');
        assert.equal(contractError(`${REQUIRED}&outputFps=24`).code, 'INVALID_ENUM');
        assert.equal(contractError(`${REQUIRED}&bloomStrategy=nope`).code, 'INVALID_ENUM');
    });

    void test('rejects partial, non-finite, and out-of-range numbers', () => {
        assert.equal(contractError(`${REQUIRED}&zoom=1px`).code, 'INVALID_NUMBER');
        assert.equal(contractError(`${REQUIRED}&zoom=Infinity`).code, 'INVALID_NUMBER');
        assert.equal(contractError(`${REQUIRED}&zoom=3.01`).code, 'NUMBER_OUT_OF_RANGE');
        assert.equal(contractError(`${REQUIRED}&translateX=-0.01`).code, 'NUMBER_OUT_OF_RANGE');
    });

    void test('rejects non-binary booleans', () => {
        assert.equal(contractError(`${REQUIRED}&hidden=true`).code, 'INVALID_BOOLEAN');
        assert.equal(contractError(`${REQUIRED}&hidden=`).code, 'INVALID_BOOLEAN');
    });

    void test('requires credential-free absolute HTTP(S) input URLs', () => {
        assert.equal(contractError(REQUIRED.replace('https%3A%2F%2Fexample.com%2Fjob.zip', 'ftp%3A%2F%2Fexample.com%2Fjob.zip')).code, 'INVALID_INPUT_URL');
        assert.equal(contractError(REQUIRED.replace('https%3A%2F%2Fexample.com%2Fjob.zip', 'https%3A%2F%2Fu%3Ap%40example.com%2Fjob.zip')).code, 'INPUT_URL_CREDENTIALS');
        assert.equal(contractError(REQUIRED.replace('https%3A%2F%2Fexample.com%2Fjob.zip', 'relative.zip')).code, 'INVALID_INPUT_URL');
    });

    void test('rejects overlong query strings', () => {
        assert.equal(contractError(`?${'x'.repeat(MAX_PRODUCTION_QUERY_LENGTH + 1)}`).code, 'QUERY_TOO_LONG');
    });

    void test('resolves normalized translation after dimensions are known', () => {
        assert.deepEqual(resolveProductionTranslation({ translateX: 0.25, translateY: 0.75 }, 640, 480), { x: 160, y: 360 });
        assert.throws(() => resolveProductionTranslation({ translateX: 0.5, translateY: 0.5 }, 0, 480), RangeError);
    });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSidecarTransport } from '../../src/production/transport';

const transport = { kind: 'sidecar' as const, endpoint: 'https://sidecar.example/', jobId: 'job_1', token: 'a'.repeat(43) };

void test('normalizes trusted sidecar transport without exposing it through query parsing', () => {
    assert.deepEqual(normalizeSidecarTransport(transport), { ...transport, endpoint: 'https://sidecar.example' });
});

void test('rejects credentials, invalid job ids, and weak capability values', () => {
    assert.throws(() => normalizeSidecarTransport({ ...transport, endpoint: 'https://u:p@sidecar.example' }), /INVALID_SIDECAR_TRANSPORT/);
    assert.throws(() => normalizeSidecarTransport({ ...transport, jobId: '../job' }), /INVALID_SIDECAR_TRANSPORT/);
    assert.throws(() => normalizeSidecarTransport({ ...transport, token: 'short' }), /INVALID_SIDECAR_TRANSPORT/);
});

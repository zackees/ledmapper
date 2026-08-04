export interface DirectProductionTransport { kind: 'direct'; }

/** Provided only through window.__lmProduction, never in a public job URL. */
export interface SidecarProductionTransport {
    kind: 'sidecar';
    endpoint: string;
    jobId: string;
    token: string;
}

export type ProductionTransport = DirectProductionTransport | SidecarProductionTransport;

const JOB_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function normalizeSidecarTransport(value: SidecarProductionTransport): SidecarProductionTransport {
    if (!JOB_ID.test(value.jobId) || value.token.length < 40 || /\s/.test(value.token)) {
        throw new Error('INVALID_SIDECAR_TRANSPORT');
    }
    let endpoint: URL;
    try { endpoint = new URL(value.endpoint); } catch { throw new Error('INVALID_SIDECAR_TRANSPORT'); }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        throw new Error('INVALID_SIDECAR_TRANSPORT');
    }
    return { kind: 'sidecar', endpoint: endpoint.href.replace(/\/$/, ''), jobId: value.jobId, token: value.token };
}

async function getInput(transport: SidecarProductionTransport, name: 'video' | 'screenmap', mime: string): Promise<File> {
    const response = await fetch(`${transport.endpoint}/v1/jobs/${encodeURIComponent(transport.jobId)}/inputs/${name}`, {
        headers: { Authorization: `Bearer ${transport.token}` },
        credentials: 'omit',
    });
    if (!response.ok) throw new Error('SIDECAR_INPUT_FAILED');
    const blob = await response.blob();
    if (blob.type && blob.type !== mime) throw new Error('SIDECAR_INPUT_INVALID');
    return new File([blob], name === 'video' ? 'video.mp4' : 'screenmap.json', { type: mime });
}

export async function fetchSidecarInputs(value: SidecarProductionTransport): Promise<{ video: File; screenmap: File }> {
    const transport = normalizeSidecarTransport(value);
    const [video, screenmap] = await Promise.all([
        getInput(transport, 'video', 'video/mp4'),
        getInput(transport, 'screenmap', 'application/json'),
    ]);
    return { video, screenmap };
}

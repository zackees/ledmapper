import { runOfflineCaptureWorker } from './offline-capture-worker-host';

runOfflineCaptureWorker(self as unknown as Parameters<typeof runOfflineCaptureWorker>[0]);

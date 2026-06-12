import { readFileSync } from 'fs';
import type { Page } from '@playwright/test';

interface DropFileOptions {
    name: string;
    mimeType: string;
    bytes: number[];
}

/**
 * Dispatch dragover + drop events on a selector with a synthetic file.
 */
export async function dropFile(page: Page, selector: string, { name, mimeType, bytes }: DropFileOptions): Promise<void> {
    const dataTransfer = await page.evaluateHandle(({ name: n, mimeType: mt, bytes: b }: DropFileOptions) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(b)], n, { type: mt }));
        return transfer;
    }, { name, mimeType, bytes });

    await page.dispatchEvent(selector, 'dragover', { dataTransfer });
    await page.dispatchEvent(selector, 'drop', { dataTransfer });
    await dataTransfer.dispose();
}

/**
 * Drop a fixture file from disk onto a selector.
 */
export async function dropFixture(page: Page, selector: string, fixturePath: string, fileName: string, mimeType: string): Promise<void> {
    const bytes = Array.from(readFileSync(fixturePath));
    await dropFile(page, selector, { name: fileName, mimeType, bytes });
}

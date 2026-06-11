import { readFileSync } from 'fs';

/**
 * Dispatch dragover + drop events on a selector with a synthetic file.
 */
export async function dropFile(page, selector, { name, mimeType, bytes }) {
    const dataTransfer = await page.evaluateHandle(({ name, mimeType, bytes }) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(bytes)], name, { type: mimeType }));
        return transfer;
    }, { name, mimeType, bytes });

    await page.dispatchEvent(selector, 'dragover', { dataTransfer });
    await page.dispatchEvent(selector, 'drop', { dataTransfer });
    await dataTransfer.dispose();
}

/**
 * Drop a fixture file from disk onto a selector.
 */
export async function dropFixture(page, selector, fixturePath, fileName, mimeType) {
    const bytes = Array.from(readFileSync(fixturePath));
    await dropFile(page, selector, { name: fileName, mimeType, bytes });
}

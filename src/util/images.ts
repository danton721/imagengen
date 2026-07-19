import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OUTPUT_DIR } from '../config.js';

const EXT_BY_MIME: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp'
};

function extensionFor(mimeType: string): string {
    return EXT_BY_MIME[mimeType] ?? 'png';
}

export function defaultBaseName(prefix: string): string {
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '');
    return `${prefix}_${timestamp}`;
}

// Strips path separators/traversal so a model- or prompt-derived filename can
// never write outside OUTPUT_DIR.
export function sanitizeBaseName(name: string): string {
    const cleaned = name.replace(/[/\\]/g, '_').replace(/\.\./g, '_').replace(/[^a-zA-Z0-9_-]/g, '_');
    return cleaned.length > 0 ? cleaned : defaultBaseName('img');
}

export async function saveImages(images: Array<{ data: string; mimeType: string }>, baseName: string): Promise<string[]> {
    await mkdir(OUTPUT_DIR, { recursive: true });
    const paths: string[] = [];
    for (let i = 0; i < images.length; i++) {
        const image = images[i];
        const suffix = images.length > 1 ? `_${i + 1}` : '';
        const filePath = path.join(OUTPUT_DIR, `${baseName}${suffix}.${extensionFor(image.mimeType)}`);
        await writeFile(filePath, Buffer.from(image.data, 'base64'));
        paths.push(filePath);
    }
    return paths;
}

export async function loadImageAsBase64(pathOrDataUri: string): Promise<{ data: string; mimeType: string }> {
    if (pathOrDataUri.startsWith('data:')) {
        const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(pathOrDataUri);
        if (!match) throw new Error('Invalid data URI for input image');
        return { data: match[2], mimeType: match[1] };
    }

    const buffer = await readFile(pathOrDataUri);
    const ext = path.extname(pathOrDataUri).toLowerCase();
    const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
    return { data: buffer.toString('base64'), mimeType };
}

import { z } from 'zod';
import { defaultBaseName, sanitizeBaseName, saveImages } from '../util/images.js';
import { handlerError, isToolTextContent, resolveTarget } from './common.js';

export const textToImageInputSchema = {
    prompt: z.string().describe('Text description of the image to generate.'),
    provider: z
        .enum(['gemini', 'grok', 'gpt-image'])
        .optional()
        .describe(
            'Which image provider to use. REQUIRED when more than one of GEMINI_API_KEY / XAI_API_KEY / ' +
                'OPENAI_API_KEY is configured and IMAGE_PROVIDER_DEFAULT is not set. In that case: first check your ' +
                'memory for a stored user preference for a default image provider; if there is none, ask the user ' +
                'which provider to use before calling this tool, then remember their answer for future calls.'
        ),
    model: z
        .string()
        .optional()
        .describe("Specific model id. Defaults to that provider's latest non-top-tier model. Call list_image_providers to see options."),
    quality: z.string().optional().describe('Provider-specific quality hint (e.g. "low"/"medium"/"high" for gpt-image). Defaults to a non-maximum tier.'),
    size: z.string().optional().describe('Provider-specific size string, e.g. "1024x1024".'),
    aspect_ratio: z.string().optional().describe('Aspect ratio such as "16:9" (Gemini only).'),
    n: z.number().int().min(1).max(10).optional().describe('Number of images to generate. Default 1.'),
    filename: z.string().optional().describe('Base filename (without extension) to save the image as.')
};

type Args = {
    prompt: string;
    provider?: string;
    model?: string;
    quality?: string;
    size?: string;
    aspect_ratio?: string;
    n?: number;
    filename?: string;
};

export async function textToImageHandler(args: Args) {
    const target = await resolveTarget(args.provider, args.model);
    if (isToolTextContent(target)) return target;

    try {
        const images = await target.provider.generate({
            prompt: args.prompt,
            model: target.model,
            quality: args.quality,
            size: args.size,
            aspectRatio: args.aspect_ratio,
            n: args.n
        });

        const baseName = sanitizeBaseName(args.filename ?? defaultBaseName('img'));
        const paths = await saveImages(images, baseName);

        return {
            content: [
                {
                    type: 'text' as const,
                    text: JSON.stringify({ paths, provider: target.provider.id, model: target.model }, null, 2)
                }
            ]
        };
    } catch (err) {
        return handlerError(err);
    }
}

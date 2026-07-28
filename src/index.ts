#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { imageToImageHandler, imageToImageInputSchema } from './tools/imageToImage.js';
import { listProvidersHandler, listProvidersInputSchema } from './tools/listProviders.js';
import { textToImageHandler, textToImageInputSchema } from './tools/textToImage.js';

const server = new McpServer({ name: 'imagengen', version: '0.2.2' });

server.registerTool(
    'list_image_providers',
    {
        title: 'List image providers',
        description:
            'Lists which image providers (gemini, grok, gpt-image, impossibl) are configured via API key, their available ' +
            'models (discovered live from each provider), and which provider/model would be used by default.',
        inputSchema: listProvidersInputSchema
    },
    listProvidersHandler
);

server.registerTool(
    'text-to-image',
    {
        title: 'Generate image from text',
        description: 'Generates an image from a text prompt using Gemini, Grok Image, GPT-image, or impossibl.com, and saves it to disk.',
        inputSchema: textToImageInputSchema
    },
    textToImageHandler
);

server.registerTool(
    'image-to-image',
    {
        title: 'Edit image from text + input image(s)',
        description:
            'Edits or transforms one or more input images according to a text prompt, using Gemini, Grok Image, ' +
            'or GPT-image, and saves the result to disk. (impossibl.com does not support this tool.)',
        inputSchema: imageToImageInputSchema
    },
    imageToImageHandler
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch(err => {
    console.error('Fatal error starting imagengen server:', err);
    process.exit(1);
});

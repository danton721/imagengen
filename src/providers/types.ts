import type { ProviderId } from '../config.js';

export interface ModelInfo {
    id: string;
    isDefault: boolean;
}

export interface GenerateParams {
    prompt: string;
    model: string;
    quality?: string;
    size?: string;
    aspectRatio?: string;
    n?: number;
}

export interface EditParams extends GenerateParams {
    inputImages: Array<{ data: string; mimeType: string }>;
}

export interface GeneratedImage {
    data: string;
    mimeType: string;
}

export interface ImageProvider {
    readonly id: ProviderId;
    isConfigured(): boolean;
    listModels(forceRefresh?: boolean): Promise<ModelInfo[]>;
    getDefaultModel(forceRefresh?: boolean): Promise<string>;
    generate(params: GenerateParams): Promise<GeneratedImage[]>;
    edit(params: EditParams): Promise<GeneratedImage[]>;
}

import type {
  AIConfig,
  AIModelInfo,
  ChatMessage,
  ToolDefinition
} from "../types/index.js";

export interface StreamChunk {
  deltaText: string;
  deltaReasoning?: string;
  toolCalls?: Array<{
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
  }>;
  finishReason?: string | null;
}

export interface LLMRequestOptions {
  messages: ChatMessage[];
  config: AIConfig;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  onChunk: (chunk: StreamChunk) => void;
}

export interface LLMProvider {
  readonly name: string;
  listModels(baseUrl: string, apiKey: string): Promise<AIModelInfo[]>;
  streamChat(options: LLMRequestOptions): Promise<{
    fullText: string;
    finishReason: string | null;
  }>;
  healthCheck(baseUrl: string, apiKey: string): Promise<boolean>;
}

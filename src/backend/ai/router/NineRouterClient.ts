import type { LLMProvider } from "../../../shared/interfaces/index.js";
import type {
  AIConfig,
  AIModelInfo,
  ChatMessage,
  EmotionType,
  ToolCall,
  ToolDefinition
} from "../../../shared/types/index.js";
import { Logger } from "../../core/logging/Logger.js";
import { OpenAICompatibleProvider } from "../providers/OpenAICompatibleProvider.js";
import type { ToolRegistry } from "../tool-calling/ToolRegistry.js";

const VALID_EMOTIONS = new Set<EmotionType>([
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "thinking",
  "laugh"
]);

export function parseEmotionPrefix(text: string): {
  emotion: EmotionType;
  cleanText: string;
} {
  const match = text.match(/^\s*\[([a-zA-Z]+)\]\s*/);
  if (!match) {
    return { emotion: "neutral", cleanText: text };
  }
  const tag = match[1].toLowerCase() as EmotionType;
  const emotion = VALID_EMOTIONS.has(tag) ? tag : "neutral";
  return {
    emotion,
    cleanText: text.slice(match[0].length)
  };
}

export class SentenceChunker {
  private buffer = "";
  private emotionParsed = false;

  push(delta: string, onEmotion: (emotion: EmotionType) => void): string[] {
    this.buffer += delta;
    const sentences: string[] = [];

    if (!this.emotionParsed) {
      if (this.buffer.includes("]") || this.buffer.length > 20) {
        const parsed = parseEmotionPrefix(this.buffer);
        this.buffer = parsed.cleanText;
        this.emotionParsed = true;
        onEmotion(parsed.emotion);
      } else {
        return sentences;
      }
    }

    // Split on sentence boundaries, or clause boundaries once chunk is long enough for fast TTS
    const sentenceRegex = /([.!?。！？\n]+)(\s+|$)/;
    const clauseRegex = /([,;:—]+)(\s+|$)/;
    while (true) {
      const match = this.buffer.match(sentenceRegex);
      if (match && match.index !== undefined) {
        const endIdx = match.index + match[0].length;
        const sentence = this.buffer.slice(0, endIdx).trim();
        this.buffer = this.buffer.slice(endIdx);
        if (sentence.length > 0) {
          sentences.push(sentence);
        }
        continue;
      }

      if (this.buffer.length >= 28) {
        const clauseMatch = this.buffer.match(clauseRegex);
        if (clauseMatch && clauseMatch.index !== undefined && clauseMatch.index >= 14) {
          const endIdx = clauseMatch.index + clauseMatch[0].length;
          const clause = this.buffer.slice(0, endIdx).trim();
          this.buffer = this.buffer.slice(endIdx);
          if (clause.length > 0) {
            sentences.push(clause);
          }
          continue;
        }
      }
      break;
    }

    return sentences;
  }

  flush(onEmotion: (emotion: EmotionType) => void): string | null {
    if (!this.emotionParsed && this.buffer.length > 0) {
      const parsed = parseEmotionPrefix(this.buffer);
      this.buffer = parsed.cleanText;
      this.emotionParsed = true;
      onEmotion(parsed.emotion);
    }
    const remaining = this.buffer.trim();
    this.buffer = "";
    return remaining.length > 0 ? remaining : null;
  }
}

export class NineRouterClient {
  private readonly logger = new Logger("NineRouterClient");
  private readonly provider: LLMProvider;
  private history: ChatMessage[] = [];
  private activeAbortController: AbortController | null = null;
  private readonly maxHistoryMessages = 30;

  constructor(provider?: LLMProvider) {
    this.provider = provider ?? new OpenAICompatibleProvider();
  }

  async checkHealth(config: AIConfig): Promise<boolean> {
    return this.provider.healthCheck(config.baseUrl, config.apiKey);
  }

  async getModels(config: AIConfig): Promise<AIModelInfo[]> {
    const models = await this.provider.listModels(config.baseUrl, config.apiKey);
    this.logger.info(`Discovered ${models.length} models from ${config.baseUrl}`);
    return models;
  }

  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  setHistory(messages: ChatMessage[]): void {
    this.history = messages.slice(-this.maxHistoryMessages);
  }

  clearHistory(): void {
    this.history = [];
  }

  abortActiveRequest(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }

  async resolveEffectiveModel(config: AIConfig): Promise<string> {
    if (config.model && config.model !== "auto") {
      return config.model;
    }
    const models = await this.getModels(config);
    if (models.length === 0) {
      throw new Error("No models available on 9Router");
    }
    return models[0].id;
  }

  async sendMessage(params: {
    userText: string;
    config: AIConfig;
    systemPromptOverride?: string;
    tools?: ToolDefinition[];
    toolRegistry?: ToolRegistry;
    onToken: (delta: string) => void;
    onEmotion: (emotion: EmotionType) => void;
    onSentence: (sentence: string) => void;
    onToolCall?: (ev: { name: string; status: "running" | "done" }) => void;
  }): Promise<ChatMessage> {
    this.abortActiveRequest();
    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const effectiveModel = await this.resolveEffectiveModel(params.config);
    const effectiveConfig: AIConfig = {
      ...params.config,
      model: effectiveModel
    };

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: params.userText,
      timestamp: Date.now()
    };
    this.history.push(userMsg);
    this.trimHistory();

    const systemMessage: ChatMessage = {
      id: "system",
      role: "system",
      content: params.systemPromptOverride ?? effectiveConfig.systemPrompt,
      timestamp: 0
    };

    const effectiveTools =
      params.tools && params.tools.length > 0
        ? params.tools
        : params.toolRegistry?.getDefinitions();

    const maxToolSteps = 6;
    let finalAssistantMsg: ChatMessage | null = null;

    for (let step = 0; step < maxToolSteps; step++) {
      const chunker = new SentenceChunker();
      let detectedEmotion: EmotionType = "neutral";
      const toolCallMap = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();

      const { fullText } = await this.provider.streamChat({
        messages: [systemMessage, ...this.history],
        config: effectiveConfig,
        tools: effectiveTools,
        signal: abortController.signal,
        onChunk: (chunk) => {
          if (chunk.toolCalls && chunk.toolCalls.length > 0) {
            for (const tc of chunk.toolCalls) {
              const existing = toolCallMap.get(tc.index) ?? {
                id: tc.id || `call_${step}_${tc.index}`,
                name: "",
                arguments: ""
              };
              if (tc.id) existing.id = tc.id;
              if (tc.name) existing.name += tc.name;
              if (tc.argumentsDelta) existing.arguments += tc.argumentsDelta;
              toolCallMap.set(tc.index, existing);
            }
          }

          if (!chunk.deltaText) return;
          params.onToken(chunk.deltaText);
          const sentences = chunker.push(chunk.deltaText, (emotion) => {
            detectedEmotion = emotion;
            params.onEmotion(emotion);
          });
          for (const s of sentences) {
            params.onSentence(s);
          }
        }
      });

      if (toolCallMap.size > 0 && params.toolRegistry) {
        const orderedCalls: ToolCall[] = Array.from(toolCallMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, tc]) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: tc.arguments || "{}"
            }
          }));

        this.history.push({
          id: `assistant-tc-${Date.now()}-${step}`,
          role: "assistant",
          content: fullText || "",
          toolCalls: orderedCalls,
          timestamp: Date.now()
        });

        for (const tc of orderedCalls) {
          params.onToolCall?.({ name: tc.function.name, status: "running" });
          let toolResult: unknown;
          try {
            const parsedArgs = JSON.parse(tc.function.arguments || "{}") as Record<
              string,
              unknown
            >;
            toolResult = await params.toolRegistry.execute(tc.function.name, parsedArgs);
          } catch (err) {
            toolResult = {
              error: err instanceof Error ? err.message : String(err)
            };
          }
          params.onToolCall?.({ name: tc.function.name, status: "done" });

          this.history.push({
            id: `tool-${Date.now()}-${tc.id}`,
            role: "tool",
            toolCallId: tc.id,
            content:
              typeof toolResult === "string"
                ? toolResult
                : JSON.stringify(toolResult),
            timestamp: Date.now()
          });
        }
        continue;
      }

      const tail = chunker.flush((emotion) => {
        detectedEmotion = emotion;
        params.onEmotion(emotion);
      });
      if (tail) {
        params.onSentence(tail);
      }

      const { emotion, cleanText } = parseEmotionPrefix(fullText);
      if (emotion !== "neutral") {
        detectedEmotion = emotion;
      }

      finalAssistantMsg = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: cleanText.trim(),
        emotion: detectedEmotion,
        timestamp: Date.now()
      };

      this.history.push(finalAssistantMsg);
      this.trimHistory();
      break;
    }

    if (this.activeAbortController === abortController) {
      this.activeAbortController = null;
    }

    if (!finalAssistantMsg) {
      finalAssistantMsg = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: "Maaf, aku butuh terlalu banyak langkah untuk memproses itu.",
        emotion: "thinking",
        timestamp: Date.now()
      };
      this.history.push(finalAssistantMsg);
      this.trimHistory();
    }

    return finalAssistantMsg;
  }

  private trimHistory(): void {
    if (this.history.length > this.maxHistoryMessages) {
      this.history = this.history.slice(-this.maxHistoryMessages);
    }
  }
}

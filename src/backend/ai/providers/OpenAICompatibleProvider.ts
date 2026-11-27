import type {
  LLMProvider,
  LLMRequestOptions
} from "../../../shared/interfaces/index.js";
import type { AIModelInfo } from "../../../shared/types/index.js";
import { Logger } from "../../core/logging/Logger.js";

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = "openai-compatible";
  private readonly logger = new Logger("OpenAICompatibleProvider");

  async healthCheck(baseUrl: string, apiKey: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const headers: Record<string, string> = {};
      if (apiKey.trim()) {
        headers.Authorization = `Bearer ${apiKey.trim()}`;
      }
      const res = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
        headers,
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!res.ok) {
        this.logger.warn(`Health check failed for ${baseUrl}/models: HTTP ${res.status}`);
      }
      return res.ok;
    } catch (err) {
      this.logger.warn(
        `Health check error for ${baseUrl}/models: ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    }
  }

  async listModels(baseUrl: string, apiKey: string): Promise<AIModelInfo[]> {
    const url = `${normalizeBaseUrl(baseUrl)}/models`;
    const headers: Record<string, string> = {};
    if (apiKey.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }
    const res = await fetch(url, { headers });

    if (!res.ok) {
      throw new Error(`Failed to list models (${res.status}): ${await res.text()}`);
    }

    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        owned_by?: string;
        capabilities?: AIModelInfo["capabilities"];
      }>;
    };

    return (json.data ?? []).map((item) => ({
      id: item.id,
      ownedBy: item.owned_by ?? "unknown",
      capabilities: item.capabilities
    }));
  }

  async streamChat(options: LLMRequestOptions): Promise<{
    fullText: string;
    finishReason: string | null;
  }> {
    const { messages, config, tools, signal, onChunk } = options;
    const url = `${normalizeBaseUrl(config.baseUrl)}/chat/completions`;

    const payload: Record<string, unknown> = {
      model: config.model,
      stream: true,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls ? { tool_calls: m.toolCalls } : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {})
      }))
    };

    if (config.reasoningEffort && config.reasoningEffort !== "none") {
      payload.reasoning_effort = config.reasoningEffort;
    }
    if (tools && tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = "auto";
    }

    const maxRetries = 2;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`
          },
          body: JSON.stringify(payload),
          signal
        });

        if (!res.ok) {
          const errBody = await res.text();
          if (RETRYABLE_STATUS_CODES.has(res.status) && attempt < maxRetries) {
            const delayMs = 500 * Math.pow(2, attempt);
            this.logger.warn(
              `Retryable status ${res.status} on attempt ${attempt + 1}, waiting ${delayMs}ms`
            );
            await sleep(delayMs);
            continue;
          }
          throw new Error(`LLM request failed (${res.status}): ${errBody}`);
        }

        if (!res.body) {
          throw new Error("Response body is empty");
        }

        return await this.consumeSSEStream(res.body, onChunk, signal);
      } catch (err) {
        if (signal?.aborted) {
          throw err;
        }
        lastError = err;
        if (attempt < maxRetries) {
          const delayMs = 500 * Math.pow(2, attempt);
          this.logger.warn(`Network error on attempt ${attempt + 1}, retrying in ${delayMs}ms`);
          await sleep(delayMs);
          continue;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async consumeSSEStream(
    body: ReadableStream<Uint8Array>,
    onChunk: LLMRequestOptions["onChunk"],
    signal?: AbortSignal
  ): Promise<{ fullText: string; finishReason: string | null }> {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullText = "";
    let finishReason: string | null = null;

    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || !line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (dataStr === "[DONE]") {
            return { fullText, finishReason };
          }

          try {
            const parsed = JSON.parse(dataStr) as {
              choices?: Array<{
                delta?: {
                  content?: string;
                  reasoning_content?: string;
                  tool_calls?: Array<{
                    index: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
                finish_reason?: string | null;
              }>;
            };

            const choice = parsed.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }

            const deltaText = choice.delta?.content ?? "";
            const deltaReasoning = choice.delta?.reasoning_content;
            const toolCalls = choice.delta?.tool_calls?.map((tc) => ({
              index: tc.index,
              id: tc.id,
              name: tc.function?.name,
              argumentsDelta: tc.function?.arguments
            }));

            if (deltaText) {
              fullText += deltaText;
            }

            if (deltaText || deltaReasoning || toolCalls?.length || finishReason) {
              onChunk({
                deltaText,
                deltaReasoning,
                toolCalls,
                finishReason
              });
            }
          } catch {
            // Ignore malformed partial SSE frames
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { fullText, finishReason };
  }
}

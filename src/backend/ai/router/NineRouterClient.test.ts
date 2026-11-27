import { describe, expect, it } from "vitest";
import { NineRouterClient, parseEmotionPrefix, SentenceChunker } from "./NineRouterClient.js";
import { ToolRegistry } from "../tool-calling/ToolRegistry.js";
import type { LLMProvider } from "../../../shared/interfaces/index.js";
import type { EmotionType } from "../../../shared/types/index.js";

describe("NineRouterClient utilities", () => {
  it("parses valid emotion prefixes", () => {
    const res = parseEmotionPrefix("[happy] Halo! Apa kabar?");
    expect(res.emotion).toBe("happy");
    expect(res.cleanText).toBe("Halo! Apa kabar?");
  });

  it("falls back to neutral for unknown tags", () => {
    const res = parseEmotionPrefix("[excited] Let's go!");
    expect(res.emotion).toBe("neutral");
    expect(res.cleanText).toBe("Let's go!");
  });

  it("splits streaming tokens into sentences while stripping emotion tag", () => {
    const chunker = new SentenceChunker();
    let detected: EmotionType = "neutral";
    const sentences: string[] = [];

    const tokens = ["[hap", "py] Halo! ", "Nama saya ", "NIKA. ", "Senang bertemu"];
    for (const tok of tokens) {
      sentences.push(...chunker.push(tok, (e) => { detected = e; }));
    }
    const tail = chunker.flush((e) => { detected = e; });
    if (tail) sentences.push(tail);

    expect(detected).toBe("happy");
    expect(sentences).toEqual(["Halo!", "Nama saya NIKA.", "Senang bertemu"]);
  });

  it("executes registered agent tools and continues to final reply", async () => {
    let callCount = 0;
    const mockProvider: LLMProvider = {
      name: "mock",
      async healthCheck() {
        return true;
      },
      async listModels() {
        return [{ id: "mock-model", ownedBy: "test" }];
      },
      async streamChat({ onChunk }) {
        callCount++;
        if (callCount === 1) {
          onChunk({
            deltaText: "",
            toolCalls: [
              {
                index: 0,
                id: "tc-1",
                name: "web_search",
                argumentsDelta: '{"query":"cuaca jakarta"}'
              }
            ],
            finishReason: "tool_calls"
          });
          return { fullText: "", finishReason: "tool_calls" };
        }
        onChunk({
          deltaText: "[happy] Cuaca Jakarta cerah hari ini!",
          finishReason: "stop"
        });
        return { fullText: "[happy] Cuaca Jakarta cerah hari ini!", finishReason: "stop" };
      }
    };

    const registry = new ToolRegistry();
    let searchedQuery = "";
    registry.register(
      {
        type: "function",
        function: {
          name: "web_search",
          description: "Search web",
          parameters: { type: "object", properties: { query: { type: "string" } } }
        }
      },
      async (args) => {
        searchedQuery = String(args.query);
        return { resultsText: "Jakarta cerah 31C" };
      }
    );

    const client = new NineRouterClient(mockProvider);
    const toolEvents: string[] = [];
    const reply = await client.sendMessage({
      userText: "Bagaimana cuaca Jakarta?",
      config: {
        baseUrl: "http://127.0.0.1:20128/v1",
        apiKey: "test",
        model: "mock-model",
        temperature: 0.7,
        maxTokens: 256,
        reasoningEffort: "none",
        systemPrompt: "Test"
      },
      toolRegistry: registry,
      onToken: () => {},
      onEmotion: () => {},
      onSentence: () => {},
      onToolCall: (ev) => toolEvents.push(`${ev.name}:${ev.status}`)
    });

    expect(searchedQuery).toBe("cuaca jakarta");
    expect(toolEvents).toEqual(["web_search:running", "web_search:done"]);
    expect(reply.emotion).toBe("happy");
    expect(reply.content).toBe("Cuaca Jakarta cerah hari ini!");
  });
});

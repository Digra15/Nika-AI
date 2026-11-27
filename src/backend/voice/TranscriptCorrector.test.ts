import { describe, expect, it } from "vitest";
import type { LLMProvider } from "../../shared/interfaces/index.js";
import type { AIConfig } from "../../shared/types/index.js";
import { TranscriptCorrector } from "./TranscriptCorrector.js";

const AI_CFG: AIConfig = {
  baseUrl: "http://127.0.0.1:20128/v1",
  apiKey: "test",
  model: "mock-model",
  temperature: 0.7,
  maxTokens: 512,
  reasoningEffort: "none",
  systemPrompt: "Test"
};

describe("TranscriptCorrector", () => {
  it("normalizes common phonetic mishearings and stutters instantly", () => {
    const mockProvider: LLMProvider = {
      name: "mock",
      async healthCheck() { return true; },
      async listModels() { return []; },
      async streamChat() { return { fullText: "", finishReason: "stop" }; }
    };
    const corrector = new TranscriptCorrector(mockProvider);

    expect(corrector.quickNormalize("halo nikah tolong cek nine router")).toBe(
      "halo Nika tolong cek 9Router"
    );
    expect(corrector.quickNormalize("aku aku mau tanya soal vituber")).toBe(
      "aku mau tanya soal VTuber"
    );
  });

  it("repairs low-confidence misheard voice transcript using conversation context", async () => {
    const mockProvider: LLMProvider = {
      name: "mock",
      async healthCheck() { return true; },
      async listModels() { return [{ id: "mock-model", ownedBy: "test" }]; },
      async streamChat() {
        return {
          fullText: "Nika coba cari harga emas antam hari ini",
          finishReason: "stop"
        };
      }
    };

    const corrector = new TranscriptCorrector(mockProvider);
    const res = await corrector.correct({
      text: "nikah coba cari harga cemas hantam hari ini",
      confidence: 0.68,
      isVoiceInput: true,
      config: AI_CFG,
      recentHistory: [
        { id: "1", role: "user", content: "Mau cek investasi logam mulia", timestamp: 1 }
      ],
      memories: []
    });

    expect(res.wasModified).toBe(true);
    expect(res.correctedText).toBe("Nika coba cari harga emas antam hari ini");
  });
});

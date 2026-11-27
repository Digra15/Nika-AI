import { describe, expect, it } from "vitest";
import type { LLMProvider } from "../../../shared/interfaces/index.js";
import type { AIConfig } from "../../../shared/types/index.js";
import { NikaBrain } from "./NikaBrain.js";

const BASE_AI_CONFIG: AIConfig = {
  baseUrl: "http://127.0.0.1:20128/v1",
  apiKey: "test",
  model: "mock-model",
  temperature: 0.7,
  maxTokens: 512,
  reasoningEffort: "medium",
  systemPrompt: "Test"
};

function createMockProvider(): LLMProvider {
  return {
    name: "mock",
    async healthCheck() {
      return true;
    },
    async listModels() {
      return [{ id: "mock-model", ownedBy: "test" }];
    },
    async streamChat({ messages }) {
      const sys = messages[0]?.content ?? "";
      if (sys.includes("self-reflection")) {
        return {
          fullText: '{"passed": true, "critique": "Accurate and concise.", "suggestions": ""}',
          finishReason: "stop"
        };
      }
      return {
        fullText: `Output for ${messages[1]?.content.slice(0, 40)}`,
        finishReason: "stop"
      };
    }
  };
}

describe("NikaBrain", () => {
  it("analyzes conversation context and suggests appropriate cognitive skills", () => {
    const brain = new NikaBrain(createMockProvider());
    const analysis = brain.analyzeContext({
      userText: "Buatkan rencana belajar TypeScript dan analisis kenapa kode ini error",
      recentHistory: [
        { id: "1", role: "user", content: "Aku lagi belajar backend", timestamp: 1 }
      ],
      memories: [],
      mind: {
        mood: "curious",
        happiness: 75,
        affection: 60,
        energy: 80,
        trust: 65,
        interactionCount: 2,
        lastInteractionAt: Date.now()
      }
    });

    expect(analysis.intent).toBe("planning");
    expect(analysis.complexity).toBe("complex");
    expect(analysis.suggestedSkills).toContain("planning-agent");
    expect(analysis.suggestedSkills).toContain("multi-agent-orchestration");
  });

  it("creates and advances planning-agent steps", () => {
    const brain = new NikaBrain(createMockProvider());
    const plan = brain.createPlan("Riset harga laptop", ["Cari spek", "Bandingkan harga"]);
    expect(plan.steps[0].status).toBe("in_progress");
    expect(plan.steps[1].status).toBe("pending");

    const updated = brain.updatePlanStep(1, "done", "Spek ditemukan");
    expect(updated?.steps[0].status).toBe("done");
    expect(updated?.steps[1].status).toBe("in_progress");
  });

  it("orchestrates multiple sub-agents in parallel and runs self-reflection", async () => {
    const brain = new NikaBrain(createMockProvider());
    const outputs = await brain.delegateToAgents({
      goal: "Evaluasi arsitektur",
      tasks: [
        { role: "researcher", task: "Cek best practice" },
        { role: "critic", task: "Audit risiko" }
      ],
      config: BASE_AI_CONFIG
    });

    expect(outputs).toHaveLength(2);
    expect(outputs[0].role).toBe("researcher");
    expect(outputs[1].role).toBe("critic");

    const reflection = await brain.reflectOnWork({
      goal: "Evaluasi arsitektur",
      draftWork: "Arsitektur sudah modular.",
      config: BASE_AI_CONFIG
    });
    expect(reflection.passed).toBe(true);
    expect(reflection.critique).toContain("Accurate");
  });
});

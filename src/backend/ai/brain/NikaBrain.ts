import type { LLMProvider } from "../../../shared/interfaces/index.js";
import type {
  AIConfig,
  ChatMessage,
  MemoryItem,
  NikaMindState
} from "../../../shared/types/index.js";

export type SubAgentRole = "researcher" | "reasoner" | "planner" | "critic";

export interface PlanStep {
  id: number;
  title: string;
  status: "pending" | "in_progress" | "done" | "failed";
  result?: string;
}

export interface AgentPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  createdAt: number;
  updatedAt: number;
}

export interface ContextAnalysis {
  intent: "chat" | "question" | "research" | "planning" | "problem_solving";
  complexity: "simple" | "moderate" | "complex";
  topic: string;
  suggestedSkills: string[];
}

export interface SubAgentTask {
  role: SubAgentRole;
  task: string;
}

export interface SubAgentOutput {
  role: SubAgentRole;
  task: string;
  output: string;
}

const ROLE_PROMPTS: Record<SubAgentRole, string> = {
  researcher:
    "You are a focused Research Sub-Agent. Provide concise, accurate facts, key points, and evidence for your assigned task.",
  reasoner:
    "You are a step-by-step Reasoning Sub-Agent. Break down the problem logically, verify assumptions, and state a clear conclusion.",
  planner:
    "You are a Planning Sub-Agent. Produce an actionable, ordered step-by-step execution plan with clear milestones.",
  critic:
    "You are a Self-Reflection & Critic Sub-Agent. Audit the draft/work for factual gaps, logic errors, or missing details, and suggest concrete fixes."
};

export class NikaBrain {
  private activePlan: AgentPlan | null = null;

  constructor(private readonly provider: LLMProvider) {}

  getActivePlan(): AgentPlan | null {
    return this.activePlan ? structuredClone(this.activePlan) : null;
  }

  clearPlan(): void {
    this.activePlan = null;
  }

  analyzeContext(params: {
    userText: string;
    recentHistory: ChatMessage[];
    memories: MemoryItem[];
    mind: NikaMindState;
  }): ContextAnalysis {
    const text = params.userText.trim();
    const lower = text.toLowerCase();

    const isResearch =
      /\b(cari|cek|berita|terbaru|harga|cuaca|siapa|kapan|dimana|search|browse|web|google|info)\b/.test(
        lower
      );
    const isPlanning =
      /\b(rencana|rencanakan|step|langkah|buatkan|jadwal|roadmap|plan|strategi|bagaimana cara)\b/.test(
        lower
      );
    const isProblemSolving =
      /\b(kenapa|mengapa|error|bug|bandingkan|analisis|hitung|pecahkan|solusi|explain|analyze|compare|debug)\b/.test(
        lower
      );
    const isQuestion = text.includes("?") || isResearch || isProblemSolving;

    let intent: ContextAnalysis["intent"] = "chat";
    if (isPlanning) intent = "planning";
    else if (isResearch) intent = "research";
    else if (isProblemSolving) intent = "problem_solving";
    else if (isQuestion) intent = "question";

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const complexity: ContextAnalysis["complexity"] =
      isPlanning || (isProblemSolving && wordCount > 10) || wordCount > 24
        ? "complex"
        : isQuestion || wordCount > 8
          ? "moderate"
          : "simple";

    const suggestedSkills: string[] = ["context-awareness", "long-term-memory"];
    if (complexity !== "simple") suggestedSkills.push("reasoning");
    if (intent === "planning" || complexity === "complex") {
      suggestedSkills.push("planning-agent", "self-reflection");
    }
    if (complexity === "complex" && (isResearch || isProblemSolving || isPlanning)) {
      suggestedSkills.push("multi-agent-orchestration");
    }

    const lastUserTopics = params.recentHistory
      .filter((m) => m.role === "user")
      .slice(-2)
      .map((m) => m.content.slice(0, 60));

    const topic =
      lastUserTopics.length > 0
        ? `${text.slice(0, 80)} (konteks sebelumnya: ${lastUserTopics.join(" -> ")})`
        : text.slice(0, 80);

    return {
      intent,
      complexity,
      topic,
      suggestedSkills
    };
  }

  createPlan(goal: string, stepTitles: string[]): AgentPlan {
    const now = Date.now();
    this.activePlan = {
      id: `plan-${now}`,
      goal: goal.trim(),
      steps: stepTitles.map((title, idx) => ({
        id: idx + 1,
        title: title.trim(),
        status: idx === 0 ? "in_progress" : "pending"
      })),
      createdAt: now,
      updatedAt: now
    };
    return structuredClone(this.activePlan);
  }

  updatePlanStep(
    stepId: number,
    status: PlanStep["status"],
    result?: string
  ): AgentPlan | null {
    if (!this.activePlan) return null;
    const step = this.activePlan.steps.find((s) => s.id === stepId);
    if (step) {
      step.status = status;
      if (result !== undefined) step.result = result;
    }
    if (status === "done") {
      const nextPending = this.activePlan.steps.find((s) => s.status === "pending");
      if (nextPending) {
        nextPending.status = "in_progress";
      }
    }
    this.activePlan.updatedAt = Date.now();
    return structuredClone(this.activePlan);
  }

  async delegateToAgents(params: {
    goal: string;
    tasks: SubAgentTask[];
    config: AIConfig;
  }): Promise<SubAgentOutput[]> {
    const cappedTasks = params.tasks.slice(0, 4);
    const results = await Promise.all(
      cappedTasks.map(async (item): Promise<SubAgentOutput> => {
        const systemPrompt = ROLE_PROMPTS[item.role] || ROLE_PROMPTS.reasoner;
        const subConfig: AIConfig = {
          ...params.config,
          temperature: Math.min(0.6, params.config.temperature),
          maxTokens: Math.min(512, params.config.maxTokens)
        };
        try {
          const { fullText } = await this.provider.streamChat({
            messages: [
              { id: "sys", role: "system", content: systemPrompt, timestamp: 0 },
              {
                id: "usr",
                role: "user",
                content: `Overall Goal: ${params.goal}\nYour Task: ${item.task}`,
                timestamp: Date.now()
              }
            ],
            config: subConfig,
            onChunk: () => {}
          });
          return {
            role: item.role,
            task: item.task,
            output: fullText.trim()
          };
        } catch (err) {
          return {
            role: item.role,
            task: item.task,
            output: `Sub-agent error: ${err instanceof Error ? err.message : String(err)}`
          };
        }
      })
    );
    return results;
  }

  async reflectOnWork(params: {
    goal: string;
    draftWork: string;
    config: AIConfig;
  }): Promise<{ passed: boolean; critique: string; suggestions: string }> {
    const subConfig: AIConfig = {
      ...params.config,
      temperature: 0.2,
      maxTokens: 320
    };
    try {
      const { fullText } = await this.provider.streamChat({
        messages: [
          {
            id: "sys",
            role: "system",
            content:
              "You are Nika's self-reflection module. Check if the draft accurately, completely, and naturally answers the user's goal. Reply concisely in JSON: {\"passed\": boolean, \"critique\": string, \"suggestions\": string}.",
            timestamp: 0
          },
          {
            id: "usr",
            role: "user",
            content: `User Goal: ${params.goal}\n\nDraft Work:\n${params.draftWork}`,
            timestamp: Date.now()
          }
        ],
        config: subConfig,
        onChunk: () => {}
      });
      const jsonMatch = fullText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          passed?: boolean;
          critique?: string;
          suggestions?: string;
        };
        return {
          passed: Boolean(parsed.passed ?? true),
          critique: String(parsed.critique ?? "Looks good"),
          suggestions: String(parsed.suggestions ?? "")
        };
      }
      return { passed: true, critique: fullText.trim(), suggestions: "" };
    } catch (err) {
      return {
        passed: true,
        critique: `Reflection skipped: ${err instanceof Error ? err.message : String(err)}`,
        suggestions: ""
      };
    }
  }
}

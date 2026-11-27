import type { AIConfig } from "../../../shared/types/index.js";
import type { ToolRegistry } from "../tool-calling/ToolRegistry.js";
import type { AgentPlan, NikaBrain, PlanStep, SubAgentTask } from "./NikaBrain.js";

export function registerBrainTools(params: {
  registry: ToolRegistry;
  brain: NikaBrain;
  getAIConfig: () => AIConfig;
  onPlanUpdated?: (plan: AgentPlan | null) => void;
}): void {
  const { registry, brain, getAIConfig, onPlanUpdated } = params;

  registry.register(
    {
      type: "function",
      function: {
        name: "brain_reason",
        description:
          "Pecahkan masalah kompleks secara bertahap (step-by-step reasoning) sebelum menjawab user.",
        parameters: {
          type: "object",
          properties: {
            problem: { type: "string", description: "Masalah yang dianalisis." },
            steps: {
              type: "array",
              items: { type: "string" },
              description: "Langkah-langkah pemikiran logis."
            },
            conclusion: { type: "string", description: "Kesimpulan akhir." }
          },
          required: ["problem", "steps", "conclusion"]
        }
      }
    },
    async (args) => {
      return {
        recorded: true,
        problem: String(args.problem ?? ""),
        steps: Array.isArray(args.steps) ? args.steps : [],
        conclusion: String(args.conclusion ?? "")
      };
    }
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "brain_plan_create",
        description:
          "Buat rencana kerja terstruktur (planning-agent) untuk tugas multi-langkah.",
        parameters: {
          type: "object",
          properties: {
            goal: { type: "string", description: "Tujuan utama rencana." },
            steps: {
              type: "array",
              items: { type: "string" },
              description: "Daftar langkah kerja berurutan."
            }
          },
          required: ["goal", "steps"]
        }
      }
    },
    async (args) => {
      const goal = String(args.goal ?? "");
      const steps = Array.isArray(args.steps) ? args.steps.map(String) : [];
      const plan = brain.createPlan(goal, steps);
      onPlanUpdated?.(plan);
      return plan;
    }
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "brain_plan_update",
        description: "Perbarui status langkah pada rencana aktif (done / failed / in_progress).",
        parameters: {
          type: "object",
          properties: {
            stepId: { type: "number", description: "Nomor langkah (mulai dari 1)." },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "done", "failed"]
            },
            result: { type: "string", description: "Ringkasan hasil langkah." }
          },
          required: ["stepId", "status"]
        }
      }
    },
    async (args) => {
      const plan = brain.updatePlanStep(
        Number(args.stepId ?? 1),
        (args.status as PlanStep["status"]) || "done",
        args.result !== undefined ? String(args.result) : undefined
      );
      onPlanUpdated?.(plan);
      return plan ?? { error: "No active plan" };
    }
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "brain_reflect",
        description:
          "Lakukan self-reflection untuk mengevaluasi draf jawaban atau hasil kerja sebelum disampaikan ke user.",
        parameters: {
          type: "object",
          properties: {
            goal: { type: "string", description: "Pertanyaan atau tujuan user." },
            draftWork: { type: "string", description: "Draf jawaban atau hasil yang dievaluasi." }
          },
          required: ["goal", "draftWork"]
        }
      }
    },
    async (args) => {
      return brain.reflectOnWork({
        goal: String(args.goal ?? ""),
        draftWork: String(args.draftWork ?? ""),
        config: getAIConfig()
      });
    }
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "brain_orchestrate",
        description:
          "Jalankan beberapa AI Sub-Agent spesialis secara paralel (multi-agent-orchestration: researcher, reasoner, planner, critic) untuk tugas kompleks.",
        parameters: {
          type: "object",
          properties: {
            goal: { type: "string", description: "Tujuan utama yang dikerjakan bersama." },
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  role: {
                    type: "string",
                    enum: ["researcher", "reasoner", "planner", "critic"]
                  },
                  task: { type: "string" }
                },
                required: ["role", "task"]
              }
            }
          },
          required: ["goal", "tasks"]
        }
      }
    },
    async (args) => {
      const goal = String(args.goal ?? "");
      const tasks = Array.isArray(args.tasks) ? (args.tasks as SubAgentTask[]) : [];
      const outputs = await brain.delegateToAgents({
        goal,
        tasks,
        config: getAIConfig()
      });
      return { goal, subAgentCount: outputs.length, outputs };
    }
  );
}

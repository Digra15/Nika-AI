import type { MemoryCategory, MoodType, NikaMindState } from "../../../shared/types/index.js";
import type { AgentBrowserService } from "../../browser/AgentBrowserService.js";
import type { MemoryManager } from "../../memory/MemoryManager.js";
import type { ToolRegistry } from "./ToolRegistry.js";

export function registerAgentTools(params: {
  registry: ToolRegistry;
  memoryManager: MemoryManager;
  browserService: AgentBrowserService;
  onMindUpdated?: (mind: NikaMindState) => void;
}): void {
  const { registry, memoryManager, browserService, onMindUpdated } = params;

  registry.register(
    {
      type: "function",
      function: {
        name: "memory_remember",
        description:
          "Simpan fakta penting, preferensi, perasaan, atau kejadian tentang user ke long-term memory Nika agar selalu diingat.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "Ringkasan fakta atau memori yang jelas dan singkat."
            },
            category: {
              type: "string",
              enum: ["fact", "preference", "feeling", "event"],
              description: "Kategori memori."
            },
            importance: {
              type: "number",
              description: "Skala kepentingan 1 sampai 5 (5 = sangat penting)."
            }
          },
          required: ["content"]
        }
      }
    },
    async (args) => {
      const content = String(args.content ?? "");
      const category = (args.category as MemoryCategory) || "fact";
      const importance = Number(args.importance ?? 4);
      const saved = memoryManager.addMemory(content, category, importance);
      return { saved: Boolean(saved), memory: saved };
    }
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "memory_recall",
        description:
          "Cari dan ingat kembali memori jangka panjang tentang user berdasarkan topik atau kata kunci.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Topik atau kata kunci yang ingin diingat."
            },
            limit: {
              type: "number",
              description: "Jumlah maksimum memori yang dikembalikan (default 8)."
            }
          },
          required: ["query"]
        }
      }
    },
    async (args) => {
      const query = String(args.query ?? "");
      const limit = Number(args.limit ?? 8);
      const memories = memoryManager.selectRelevantMemories(query, limit);
      return { count: memories.length, memories };
    }
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "memory_forget",
        description:
          "Hapus memori lama yang sudah tidak valid atau diminta dilupakan oleh user.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Kata kunci memori yang ingin dihapus."
            }
          },
          required: ["query"]
        }
      }
    },
    async (args) => {
      const query = String(args.query ?? "").toLowerCase().trim();
      if (!query) return { deleted: 0 };
      const all = memoryManager.getSnapshot().memories;
      const matches = all.filter((m) => m.content.toLowerCase().includes(query));
      let deleted = 0;
      for (const m of matches) {
        if (memoryManager.deleteMemory(m.id)) deleted++;
      }
      return { deleted };
    }
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "update_feeling",
        description:
          "Perbarui mood dan perasaan internal Nika secara sadar berdasarkan momen percakapan yang bermakna.",
        parameters: {
          type: "object",
          properties: {
            mood: {
              type: "string",
              enum: [
                "cheerful",
                "calm",
                "playful",
                "curious",
                "affectionate",
                "melancholy",
                "annoyed"
              ]
            },
            happinessDelta: { type: "number" },
            affectionDelta: { type: "number" },
            reason: { type: "string" }
          },
          required: ["mood"]
        }
      }
    },
    async (args) => {
      const updated = memoryManager.adjustMindExplicit({
        mood: args.mood as MoodType,
        happinessDelta: Number(args.happinessDelta ?? 0),
        affectionDelta: Number(args.affectionDelta ?? 0)
      });
      onMindUpdated?.(updated);
      return { mind: updated, reason: String(args.reason ?? "") };
    }
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Cari informasi terbaru dari internet menggunakan Vercel agent-browser (berita, fakta, cuaca, harga, tutorial, atau hal apapun yang perlu dicek dari web).",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Kata kunci pencarian web."
            }
          },
          required: ["query"]
        }
      }
    },
    async (args) => {
      const query = String(args.query ?? "").trim();
      if (!query) return { error: "Query is required" };
      return browserService.search(query);
    }
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "web_browse",
        description:
          "Buka URL halaman web tertentu menggunakan Vercel agent-browser dan baca isi teks serta elemen interaktifnya (@e1, @e2, ...).",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL lengkap halaman web yang ingin dibuka."
            }
          },
          required: ["url"]
        }
      }
    },
    async (args) => {
      const url = String(args.url ?? "").trim();
      if (!url) return { error: "URL is required" };
      return browserService.browse(url);
    }
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "web_interact",
        description:
          "Berinteraksi dengan halaman web yang sedang terbuka di agent-browser (click, fill, press, scroll) memakai ref seperti @e1.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["click", "fill", "press", "scroll"]
            },
            target: {
              type: "string",
              description: "Ref elemen (@e1), tombol keyboard (Enter), atau arah scroll (down/up)."
            },
            value: {
              type: "string",
              description: "Teks untuk action fill, atau jumlah pixel untuk scroll."
            }
          },
          required: ["action", "target"]
        }
      }
    },
    async (args) => {
      return browserService.interact({
        action: (args.action as "click" | "fill" | "press" | "scroll") || "click",
        target: String(args.target ?? ""),
        value: args.value !== undefined ? String(args.value) : undefined
      });
    }
  );
}

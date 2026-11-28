import type { ToolRegistry } from "../ai/tool-calling/ToolRegistry.js";
import type { AgentBrowserService } from "../browser/AgentBrowserService.js";
import type { DesktopControlService } from "./DesktopControlService.js";
import type { KnowledgeAssistantService } from "./KnowledgeAssistantService.js";

export function registerKnowledgeTools(params: {
  registry: ToolRegistry;
  knowledgeService: KnowledgeAssistantService;
  browserService: AgentBrowserService;
  desktopControl: DesktopControlService;
}): void {
  const { registry, knowledgeService, browserService, desktopControl } = params;

  /** 1. web-research */
  registry.register(
    {
      type: "function",
      function: {
        name: "web_research",
        description:
          "Riset internet mendalam (web-research): mencari di web lalu otomatis membuka & membaca isi halaman teratas beserta URL sumbernya.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Topik atau pertanyaan riset." },
            maxPages: {
              type: "number",
              description: "Jumlah halaman teratas yang dibaca penuh (default 2, maks 4)."
            }
          },
          required: ["query"]
        }
      }
    },
    async (args) => {
      const query = String(args.query ?? "").trim();
      if (!query) return { error: "Query riset wajib diisi." };
      return knowledgeService.researchWeb(browserService, query, Number(args.maxPages ?? 2));
    }
  );

  /** 2. document-reader */
  registry.register(
    {
      type: "function",
      function: {
        name: "document_read",
        description:
          "Membaca dokumen lokal (document-reader): mendukung PDF, DOCX, TXT, MD, CSV, JSON, HTML, dan file kode.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path absolut atau relatif ke file dokumen." },
            maxChars: {
              type: "number",
              description: "Maksimum karakter yang diambil (default 12000)."
            },
            startChar: {
              type: "number",
              description: "Offset karakter awal untuk membaca bagian lanjutan (default 0)."
            }
          },
          required: ["path"]
        }
      }
    },
    async (args) => {
      return knowledgeService.readDocument(
        String(args.path ?? ""),
        Number(args.maxChars ?? 12000),
        Number(args.startChar ?? 0)
      );
    }
  );

  /** 3. code-assistant */
  registry.register(
    {
      type: "function",
      function: {
        name: "code_assist",
        description:
          "Membantu pemrograman (code-assistant): mencari simbol/kode di project, membaca baris file, atau menjalankan perintah cek/build/test.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["search_code", "inspect_file", "run_command"],
              description: "Aksi bantuan pemrograman."
            },
            pattern: { type: "string", description: "Kata kunci/pola untuk search_code." },
            path: { type: "string", description: "Path folder/file target." },
            command: {
              type: "string",
              description: "Perintah terminal (mis. npm test, python --version) untuk run_command."
            },
            cwd: { type: "string", description: "Direktori kerja untuk run_command." }
          },
          required: ["action"]
        }
      }
    },
    async (args) => {
      const action = String(args.action ?? "");
      if (action === "search_code") {
        const pattern = String(args.pattern ?? "").trim();
        const targetDir = args.path ? String(args.path) : ".";
        if (!pattern) return { error: "pattern wajib diisi untuk search_code." };
        const safePattern = pattern.replace(/"/g, '\\"');
        return desktopControl.executeTerminal(
          `git grep -n "${safePattern}" -- "${targetDir}" | Select-Object -First 40`,
          process.cwd()
        );
      }
      if (action === "inspect_file") {
        if (!args.path) return { error: "path wajib diisi untuk inspect_file." };
        return knowledgeService.readDocument(String(args.path), 14000, 0);
      }
      if (action === "run_command") {
        if (!args.command) return { error: "command wajib diisi untuk run_command." };
        return desktopControl.executeTerminal(
          String(args.command),
          args.cwd ? String(args.cwd) : undefined
        );
      }
      return { error: `Aksi code_assist tidak dikenal: ${action}` };
    }
  );

  /** 4. knowledge-base */
  registry.register(
    {
      type: "function",
      function: {
        name: "knowledge_manage",
        description:
          "Mengelola basis pengetahuan lokal NIKA (knowledge-base): tambah catatan/referensi, cari, daftar, atau hapus entri.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["add", "search", "list", "delete"],
              description: "Operasi basis pengetahuan."
            },
            title: { type: "string", description: "Judul entri (untuk add/delete)." },
            content: { type: "string", description: "Isi pengetahuan/ringkasan (untuk add)." },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tag topik (untuk add)."
            },
            source: { type: "string", description: "Sumber referensi (opsional, untuk add)." },
            query: { type: "string", description: "Kata kunci pencarian (untuk search/delete)." },
            limit: { type: "number", description: "Batas jumlah hasil (untuk search/list)." }
          },
          required: ["action"]
        }
      }
    },
    async (args) => {
      const action = String(args.action ?? "");
      if (action === "add") {
        if (!args.title || !args.content) {
          return { error: "title dan content wajib diisi untuk menambah knowledge-base." };
        }
        const entry = knowledgeService.addKnowledge({
          title: String(args.title),
          content: String(args.content),
          tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
          source: args.source ? String(args.source) : undefined
        });
        return { saved: true, entry };
      }
      if (action === "search") {
        const items = knowledgeService.searchKnowledge(
          String(args.query ?? ""),
          Number(args.limit ?? 8)
        );
        return { count: items.length, items };
      }
      if (action === "list") {
        const items = knowledgeService.listKnowledge(Number(args.limit ?? 20));
        return { count: items.length, items };
      }
      if (action === "delete") {
        const key = String(args.query ?? args.title ?? "");
        return { deleted: knowledgeService.deleteKnowledge(key) };
      }
      return { error: `Aksi knowledge_manage tidak dikenal: ${action}` };
    }
  );

  /** 5. fact-checker */
  registry.register(
    {
      type: "function",
      function: {
        name: "fact_check",
        description:
          "Memeriksa kebenaran informasi/klaim (fact-checker) dengan membandingkan basis pengetahuan lokal dan bukti sumber web secara langsung.",
        parameters: {
          type: "object",
          properties: {
            claim: { type: "string", description: "Klaim atau informasi yang ingin diverifikasi." }
          },
          required: ["claim"]
        }
      }
    },
    async (args) => {
      const claim = String(args.claim ?? "").trim();
      if (!claim) return { error: "claim wajib diisi." };
      return knowledgeService.checkFact(browserService, claim);
    }
  );
}

import type { AIConfig } from "../../shared/types/index.js";
import type { ToolRegistry } from "../ai/tool-calling/ToolRegistry.js";
import type { AgentBrowserService } from "../browser/AgentBrowserService.js";
import type { DesktopControlService } from "./DesktopControlService.js";

export function registerDesktopTools(params: {
  registry: ToolRegistry;
  desktop: DesktopControlService;
  browserService: AgentBrowserService;
  captureScreenSummary: (question?: string, aiConfig?: AIConfig) => Promise<Record<string, unknown>>;
  getAIConfig: () => AIConfig;
}): void {
  const { registry, desktop, browserService, captureScreenSummary, getAIConfig } = params;

  /** 1. computer-use */
  registry.register(
    {
      type: "function",
      function: {
        name: "computer_use",
        description:
          "Mengoperasikan desktop Windows (computer-use): buka aplikasi (open_app), buka URL di browser utama (open_url), cek jendela aktif (active_window), klik/gerak mouse (mouse_click, mouse_move), atau ketik keyboard (type_text, key_press).",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "open_app",
                "open_url",
                "active_window",
                "mouse_click",
                "mouse_move",
                "type_text",
                "key_press"
              ]
            },
            target: {
              type: "string",
              description: "Nama aplikasi (misal notepad/calc/explorer), URL, atau teks/tombol."
            },
            x: { type: "number" },
            y: { type: "number" },
            button: { type: "string", enum: ["left", "right", "double"] }
          },
          required: ["action"]
        }
      }
    },
    async (args) => {
      return desktop.computerAction({
        action: args.action as
          | "open_app"
          | "open_url"
          | "active_window"
          | "mouse_click"
          | "mouse_move"
          | "type_text"
          | "key_press",
        target: args.target !== undefined ? String(args.target) : undefined,
        x: args.x !== undefined ? Number(args.x) : undefined,
        y: args.y !== undefined ? Number(args.y) : undefined,
        button: (args.button as "left" | "right" | "double") || "left"
      });
    }
  );

  /** 2. playwright (multi-step website automation) */
  registry.register(
    {
      type: "function",
      function: {
        name: "playwright_automate",
        description:
          "Menjalankan otomatisasi website multi-langkah ala Playwright (open, fill, click, press, wait, eval, snapshot, get_text) secara berurutan.",
        parameters: {
          type: "object",
          properties: {
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: {
                    type: "string",
                    enum: ["open", "click", "fill", "press", "wait", "eval", "snapshot", "get_text"]
                  },
                  target: { type: "string" },
                  value: { type: "string" }
                },
                required: ["action"]
              }
            }
          },
          required: ["steps"]
        }
      }
    },
    async (args) => {
      const steps = Array.isArray(args.steps)
        ? (args.steps as Array<{
            action: "open" | "click" | "fill" | "press" | "wait" | "eval" | "snapshot" | "get_text";
            target?: string;
            value?: string;
          }>)
        : [];
      return browserService.runAutomation(steps);
    }
  );

  /** 3. file-manager */
  registry.register(
    {
      type: "function",
      function: {
        name: "file_list",
        description: "Melihat daftar file dan folder pada direktori tertentu (file-manager).",
        parameters: {
          type: "object",
          properties: {
            dirPath: { type: "string", description: "Path folder (kosongkan untuk folder proyek)." }
          }
        }
      }
    },
    async (args) => desktop.listFiles(args.dirPath ? String(args.dirPath) : undefined)
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "file_read",
        description: "Membaca isi file teks (file-manager).",
        parameters: {
          type: "object",
          properties: {
            filePath: { type: "string" }
          },
          required: ["filePath"]
        }
      }
    },
    async (args) => desktop.readFileSafe(String(args.filePath ?? ""))
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "file_write",
        description: "Menulis atau membuat file teks baru (file-manager).",
        parameters: {
          type: "object",
          properties: {
            filePath: { type: "string" },
            content: { type: "string" }
          },
          required: ["filePath", "content"]
        }
      }
    },
    async (args) => desktop.writeFileSafe(String(args.filePath ?? ""), String(args.content ?? ""))
  );

  registry.register(
    {
      type: "function",
      function: {
        name: "file_delete",
        description: "Menghapus file atau folder non-sistem (file-manager).",
        parameters: {
          type: "object",
          properties: {
            filePath: { type: "string" }
          },
          required: ["filePath"]
        }
      }
    },
    async (args) => desktop.deleteFileSafe(String(args.filePath ?? ""))
  );

  /** 4. terminal-executor */
  registry.register(
    {
      type: "function",
      function: {
        name: "terminal_run",
        description:
          "Menjalankan perintah terminal PowerShell (terminal-executor) dan mengembalikan exitCode, stdout, stderr.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
            cwd: { type: "string" }
          },
          required: ["command"]
        }
      }
    },
    async (args) =>
      desktop.executeTerminal(
        String(args.command ?? ""),
        args.cwd ? String(args.cwd) : undefined
      )
  );

  /** 5. screen-understanding */
  registry.register(
    {
      type: "function",
      function: {
        name: "screen_understand",
        description:
          "Mengambil tangkapan layar desktop saat ini dan memahami apa yang sedang tampil di layar (jendela aktif, aplikasi terbuka, serta analisis visual layar).",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "Pertanyaan spesifik tentang isi layar saat ini."
            }
          }
        }
      }
    },
    async (args) =>
      captureScreenSummary(
        args.question ? String(args.question) : undefined,
        getAIConfig()
      )
  );
}

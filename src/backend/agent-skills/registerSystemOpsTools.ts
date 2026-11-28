import type { ToolRegistry } from "../ai/tool-calling/ToolRegistry.js";
import type {
  PermissionMode,
  PermissionScope,
  SystemOpsService
} from "./SystemOpsService.js";

export function registerSystemOpsTools(params: {
  registry: ToolRegistry;
  systemOps: SystemOpsService;
  sendNotification: (title: string, body: string) => Promise<{ sent: boolean; channel: string }>;
  recoverSubsystem: (target: "voice_sidecar" | "native_camera" | "browser" | "all") => Promise<{
    recovered: string[];
    errors: string[];
  }>;
}): void {
  const { registry, systemOps, sendNotification, recoverSubsystem } = params;

  /** 1. system-monitor */
  registry.register(
    {
      type: "function",
      function: {
        name: "system_monitor",
        description:
          "Memantau kondisi sistem PC secara real-time (system-monitor): penggunaan CPU, RAM, GPU, dan uptime.",
        parameters: {
          type: "object",
          properties: {}
        }
      }
    },
    async () => systemOps.getSystemMetrics()
  );

  /** 2. task-scheduler */
  registry.register(
    {
      type: "function",
      function: {
        name: "task_schedule",
        description:
          "Menjadwalkan tugas atau pengingat otomatis (task-scheduler): buat jadwal satu kali/berulang, lihat daftar, atau batalkan.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["create", "list", "cancel"],
              description: "Operasi jadwal tugas."
            },
            title: { type: "string", description: "Judul singkat tugas/pengingat." },
            instruction: { type: "string", description: "Pesan atau instruksi saat tugas berjalan." },
            delaySeconds: {
              type: "number",
              description: "Jeda waktu dalam detik sebelum tugas dijalankan (wajib untuk create)."
            },
            recurring: {
              type: "boolean",
              description: "Jika true, tugas diulang setiap delaySeconds."
            },
            idOrTitle: { type: "string", description: "ID atau judul tugas yang dibatalkan." }
          },
          required: ["action"]
        }
      }
    },
    async (args) => {
      const action = String(args.action ?? "");
      if (action === "create") {
        if (!args.title || !args.instruction || !args.delaySeconds) {
          return { error: "title, instruction, dan delaySeconds wajib diisi." };
        }
        const task = systemOps.scheduleTask({
          title: String(args.title),
          instruction: String(args.instruction),
          delaySeconds: Number(args.delaySeconds),
          recurring: Boolean(args.recurring)
        });
        return { scheduled: true, task };
      }
      if (action === "list") {
        const tasks = systemOps.listTasks();
        return { count: tasks.length, tasks };
      }
      if (action === "cancel") {
        const key = String(args.idOrTitle ?? args.title ?? "");
        return { cancelled: systemOps.cancelTask(key) };
      }
      return { error: `Aksi task_schedule tidak dikenal: ${action}` };
    }
  );

  /** 3. notification-manager */
  registry.register(
    {
      type: "function",
      function: {
        name: "notify_send",
        description:
          "Mengirim notifikasi desktop Windows / in-app kepada pengguna (notification-manager).",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Judul notifikasi." },
            body: { type: "string", description: "Isi pesan notifikasi." }
          },
          required: ["title", "body"]
        }
      }
    },
    async (args) => {
      return sendNotification(String(args.title ?? "NIKA"), String(args.body ?? ""));
    }
  );

  /** 4. error-recovery */
  registry.register(
    {
      type: "function",
      function: {
        name: "error_recover",
        description:
          "Memulihkan proses atau subsistem NIKA yang gagal/macet (error-recovery): voice_sidecar, native_camera, browser, atau all.",
        parameters: {
          type: "object",
          properties: {
            target: {
              type: "string",
              enum: ["voice_sidecar", "native_camera", "browser", "all"],
              description: "Subsistem yang ingin dipulihkan."
            }
          },
          required: ["target"]
        }
      }
    },
    async (args) => {
      const target = (args.target as "voice_sidecar" | "native_camera" | "browser" | "all") || "all";
      return recoverSubsystem(target);
    }
  );

  /** 5. permission-manager */
  registry.register(
    {
      type: "function",
      function: {
        name: "permission_manage",
        description:
          "Mengatur izin tindakan agent NIKA (permission-manager): lihat kebijakan izin, ubah mode (allow/ask/deny) per scope, cek izin, atau reset.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["get", "set", "check", "reset"],
              description: "Operasi manajemen izin."
            },
            scope: {
              type: "string",
              enum: [
                "terminal",
                "file_write",
                "file_delete",
                "computer_use",
                "game_control",
                "browser_automation"
              ],
              description: "Cakupan izin tindakan."
            },
            mode: {
              type: "string",
              enum: ["allow", "ask", "deny"],
              description: "Mode izin untuk action=set."
            }
          },
          required: ["action"]
        }
      }
    },
    async (args) => {
      const action = String(args.action ?? "");
      if (action === "get") {
        return { permissions: systemOps.getPermissions() };
      }
      if (action === "set") {
        if (!args.scope || !args.mode) {
          return { error: "scope dan mode wajib diisi untuk action=set." };
        }
        return {
          updated: true,
          permissions: systemOps.setPermission(
            args.scope as PermissionScope,
            args.mode as PermissionMode
          )
        };
      }
      if (action === "check") {
        if (!args.scope) return { error: "scope wajib diisi untuk action=check." };
        return systemOps.checkPermission(args.scope as PermissionScope);
      }
      if (action === "reset") {
        return { reset: true, permissions: systemOps.resetPermissions() };
      }
      return { error: `Aksi permission_manage tidak dikenal: ${action}` };
    }
  );
}

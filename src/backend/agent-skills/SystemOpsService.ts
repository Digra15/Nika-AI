import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type PermissionScope =
  | "terminal"
  | "file_write"
  | "file_delete"
  | "computer_use"
  | "game_control"
  | "browser_automation";

export type PermissionMode = "allow" | "ask" | "deny";

export type PermissionPolicy = Record<PermissionScope, PermissionMode>;

export interface ScheduledTask {
  id: string;
  title: string;
  instruction: string;
  intervalSeconds?: number;
  nextRunAt: string;
  recurring: boolean;
  enabled: boolean;
  runCount: number;
  createdAt: string;
}

export interface SystemMetrics {
  platform: string;
  hostname: string;
  uptimeSeconds: number;
  cpu: {
    model: string;
    cores: number;
    usagePercent: number;
  };
  memory: {
    totalGb: number;
    usedGb: number;
    freeGb: number;
    usedPercent: number;
  };
  gpu: Array<{
    name: string;
    utilizationPercent?: number;
    memoryUsedMb?: number;
    memoryTotalMb?: number;
  }>;
}

const DEFAULT_PERMISSIONS: PermissionPolicy = {
  terminal: "allow",
  file_write: "allow",
  file_delete: "ask",
  computer_use: "allow",
  game_control: "allow",
  browser_automation: "allow"
};

export class SystemOpsService {
  private readonly permissionsPath: string;
  private readonly tasksPath: string;
  private permissions: PermissionPolicy;
  private tasks: ScheduledTask[] = [];
  private timers = new Map<string, NodeJS.Timeout>();
  private onTaskTriggered?: (task: ScheduledTask) => void;

  constructor(
    userDataDir: string,
    opts?: { onTaskTriggered?: (task: ScheduledTask) => void }
  ) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.permissionsPath = path.join(userDataDir, "agent-permissions.json");
    this.tasksPath = path.join(userDataDir, "scheduled-tasks.json");
    this.onTaskTriggered = opts?.onTaskTriggered;
    this.permissions = this.loadPermissions();
    this.tasks = this.loadTasks();
    this.armPendingTasks();
  }

  private loadPermissions(): PermissionPolicy {
    if (!fs.existsSync(this.permissionsPath)) {
      return { ...DEFAULT_PERMISSIONS };
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.permissionsPath, "utf-8")) as Partial<PermissionPolicy>;
      return { ...DEFAULT_PERMISSIONS, ...raw };
    } catch {
      return { ...DEFAULT_PERMISSIONS };
    }
  }

  private savePermissions(): void {
    fs.writeFileSync(this.permissionsPath, JSON.stringify(this.permissions, null, 2), "utf-8");
  }

  private loadTasks(): ScheduledTask[] {
    if (!fs.existsSync(this.tasksPath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.tasksPath, "utf-8"));
      return Array.isArray(raw) ? (raw as ScheduledTask[]) : [];
    } catch {
      return [];
    }
  }

  private saveTasks(): void {
    fs.writeFileSync(this.tasksPath, JSON.stringify(this.tasks, null, 2), "utf-8");
  }

  /** permission-manager */
  getPermissions(): PermissionPolicy {
    return { ...this.permissions };
  }

  setPermission(scope: PermissionScope, mode: PermissionMode): PermissionPolicy {
    this.permissions[scope] = mode;
    this.savePermissions();
    return this.getPermissions();
  }

  resetPermissions(): PermissionPolicy {
    this.permissions = { ...DEFAULT_PERMISSIONS };
    this.savePermissions();
    return this.getPermissions();
  }

  checkPermission(scope: PermissionScope): { scope: PermissionScope; mode: PermissionMode; allowed: boolean } {
    const mode = this.permissions[scope] ?? "ask";
    return { scope, mode, allowed: mode === "allow" };
  }

  /** task-scheduler */
  scheduleTask(params: {
    title: string;
    instruction: string;
    delaySeconds: number;
    recurring?: boolean;
  }): ScheduledTask {
    const delaySec = Math.max(1, Math.round(params.delaySeconds));
    const task: ScheduledTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: params.title.trim(),
      instruction: params.instruction.trim(),
      ...(params.recurring ? { intervalSeconds: delaySec } : {}),
      nextRunAt: new Date(Date.now() + delaySec * 1000).toISOString(),
      recurring: Boolean(params.recurring),
      enabled: true,
      runCount: 0,
      createdAt: new Date().toISOString()
    };
    this.tasks.unshift(task);
    this.saveTasks();
    this.armTask(task);
    return task;
  }

  listTasks(): ScheduledTask[] {
    return [...this.tasks];
  }

  cancelTask(idOrTitle: string): boolean {
    const key = idOrTitle.trim().toLowerCase();
    const target = this.tasks.find(
      (t) => t.id.toLowerCase() === key || t.title.toLowerCase() === key
    );
    if (!target) return false;
    const existingTimer = this.timers.get(target.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(target.id);
    }
    this.tasks = this.tasks.filter((t) => t.id !== target.id);
    this.saveTasks();
    return true;
  }

  private armPendingTasks(): void {
    for (const task of this.tasks) {
      if (task.enabled) {
        this.armTask(task);
      }
    }
  }

  private armTask(task: ScheduledTask): void {
    const existing = this.timers.get(task.id);
    if (existing) clearTimeout(existing);

    const delayMs = Math.max(250, new Date(task.nextRunAt).getTime() - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(task.id);
      if (!task.enabled) return;
      task.runCount += 1;
      if (task.recurring && task.intervalSeconds) {
        task.nextRunAt = new Date(Date.now() + task.intervalSeconds * 1000).toISOString();
        this.saveTasks();
        this.armTask(task);
      } else {
        task.enabled = false;
        this.saveTasks();
      }
      this.onTaskTriggered?.({ ...task });
    }, Math.min(delayMs, 2147483647));
    this.timers.set(task.id, timer);
  }

  /** system-monitor */
  async getSystemMetrics(): Promise<SystemMetrics> {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    let cpuUsage = 0;
    try {
      const start = os.cpus().map((c) => c.times);
      await new Promise((r) => setTimeout(r, 150));
      const end = os.cpus().map((c) => c.times);
      let idleDelta = 0;
      let totalDelta = 0;
      for (let i = 0; i < start.length; i++) {
        const s = start[i];
        const e = end[i];
        const idle = e.idle - s.idle;
        const total =
          e.user - s.user + (e.nice - s.nice) + (e.sys - s.sys) + (e.irq - s.irq) + idle;
        idleDelta += idle;
        totalDelta += total;
      }
      cpuUsage = totalDelta > 0 ? Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10 : 0;
    } catch {
      cpuUsage = 0;
    }

    const gpu: SystemMetrics["gpu"] = [];
    try {
      const { stdout } = await execFileAsync(
        "nvidia-smi",
        ["--query-gpu=name,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
        { timeout: 3000 }
      );
      for (const line of stdout.trim().split(/\r?\n/)) {
        const parts = line.split(",").map((p) => p.trim());
        if (parts[0]) {
          gpu.push({
            name: parts[0],
            utilizationPercent: Number(parts[1]) || 0,
            memoryUsedMb: Number(parts[2]) || 0,
            memoryTotalMb: Number(parts[3]) || 0
          });
        }
      }
    } catch {
      if (process.platform === "win32") {
        try {
          const { stdout } = await execFileAsync(
            "powershell",
            [
              "-NoProfile",
              "-Command",
              "(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join '|'"
            ],
            { timeout: 3500 }
          );
          for (const name of stdout.trim().split("|").map((s) => s.trim()).filter(Boolean)) {
            gpu.push({ name });
          }
        } catch {
          // ignore
        }
      }
    }

    return {
      platform: `${os.platform()} ${os.release()}`,
      hostname: os.hostname(),
      uptimeSeconds: Math.round(os.uptime()),
      cpu: {
        model: cpus[0]?.model ?? "Unknown CPU",
        cores: cpus.length,
        usagePercent: cpuUsage
      },
      memory: {
        totalGb: Math.round((totalMem / 1024 ** 3) * 100) / 100,
        usedGb: Math.round((usedMem / 1024 ** 3) * 100) / 100,
        freeGb: Math.round((freeMem / 1024 ** 3) * 100) / 100,
        usedPercent: Math.round((usedMem / totalMem) * 1000) / 10
      },
      gpu
    };
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

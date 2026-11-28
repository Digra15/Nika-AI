import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { SystemOpsService } from "./SystemOpsService.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nika-sysops-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("SystemOpsService", () => {
  it("persists agent permission policies and checks scopes", () => {
    const dir = createTempDir();
    const svc = new SystemOpsService(dir);

    expect(svc.checkPermission("file_delete").allowed).toBe(false);
    svc.setPermission("file_delete", "allow");

    const reloaded = new SystemOpsService(dir);
    expect(reloaded.checkPermission("file_delete")).toEqual({
      scope: "file_delete",
      mode: "allow",
      allowed: true
    });
    reloaded.dispose();
  });

  it("schedules, lists, and cancels tasks cleanly", () => {
    const dir = createTempDir();
    const svc = new SystemOpsService(dir);

    const task = svc.scheduleTask({
      title: "Minum Air",
      instruction: "Ingatkan user untuk minum air",
      delaySeconds: 600,
      recurring: false
    });
    expect(svc.listTasks()).toHaveLength(1);
    expect(svc.cancelTask(task.id)).toBe(true);
    expect(svc.listTasks()).toHaveLength(0);
    svc.dispose();
  });

  it("collects CPU and RAM metrics", async () => {
    const dir = createTempDir();
    const svc = new SystemOpsService(dir);
    const metrics = await svc.getSystemMetrics();
    expect(metrics.cpu.cores).toBeGreaterThan(0);
    expect(metrics.memory.totalGb).toBeGreaterThan(0);
    svc.dispose();
  });
});

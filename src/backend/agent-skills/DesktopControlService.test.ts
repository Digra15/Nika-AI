import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopControlService } from "./DesktopControlService.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nika-desk-test-"));
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

describe("DesktopControlService", () => {
  it("writes, reads, lists, and deletes files safely", () => {
    const dir = makeTempDir();
    const svc = new DesktopControlService(dir);
    const filePath = path.join(dir, "note.txt");

    const w = svc.writeFileSafe(filePath, "Halo Nika!");
    expect(w.bytesWritten).toBe(10);

    const r = svc.readFileSafe(filePath);
    expect(r.content).toBe("Halo Nika!");

    const list = svc.listFiles(dir);
    expect(list.entries.some((e) => e.name === "note.txt")).toBe(true);

    const del = svc.deleteFileSafe(filePath);
    expect(del.deleted).toBe(true);
  });

  it("blocks destructive terminal commands and system directory writes", async () => {
    const dir = makeTempDir();
    const svc = new DesktopControlService(dir);

    expect(() => svc.writeFileSafe("C:\\Windows\\test.txt", "x")).toThrow();

    const term = await svc.executeTerminal("format C:");
    expect(term.exitCode).toBe(1);
    expect(term.stderr).toContain("Blocked");
  });
});

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { getDefaultPersonaConfig } from "../../shared/personaPresets.js";
import { MemoryManager } from "./MemoryManager.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nika-mem-test-"));
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

describe("MemoryManager", () => {
  it("extracts and persists user memories across instances", () => {
    const dir = makeTempDir();
    const mgr1 = new MemoryManager(dir);

    mgr1.extractAndStoreFromUserMessage("Namaku Raka dan aku suka kopi hitam. Ingat ya aku kerja pagi.");
    const snap1 = mgr1.getSnapshot();
    expect(snap1.memories.some((m) => m.content.includes("Raka"))).toBe(true);
    expect(snap1.memories.some((m) => m.content.includes("kopi hitam"))).toBe(true);

    const mgr2 = new MemoryManager(dir);
    const snap2 = mgr2.getSnapshot();
    expect(snap2.memories.length).toBe(snap1.memories.length);
  });

  it("updates mood and feelings dynamically from user interactions", () => {
    const dir = makeTempDir();
    const mgr = new MemoryManager(dir);
    const initial = mgr.getSnapshot().mind;

    const afterPositive = mgr.updateMindFromUserMessage("Makasih banyak Nika, kamu pintar dan lucu banget!");
    expect(afterPositive.happiness).toBeGreaterThan(initial.happiness);
    expect(afterPositive.affection).toBeGreaterThan(initial.affection);

    const afterNegative = mgr.updateMindFromUserMessage("Kamu bodoh dan menyebalkan, aku benci!");
    expect(afterNegative.happiness).toBeLessThan(afterPositive.happiness);
    expect(afterNegative.trust).toBeLessThan(afterPositive.trust);
  });

  it("builds system prompt containing persona, mood, and relevant memories", () => {
    const dir = makeTempDir();
    const mgr = new MemoryManager(dir);
    mgr.addMemory("Nama user adalah Raka", "fact", 5);

    const prompt = mgr.buildSystemPrompt({
      baseSystemPrompt: "Start with [happy].",
      persona: { ...getDefaultPersonaConfig(), userCallName: "Raka" },
      userText: "Halo Nika!"
    });

    expect(prompt).toContain("Call the user: Raka");
    expect(prompt).toContain("[CURRENT MOOD & FEELINGS]");
    expect(prompt).toContain("Nama user adalah Raka");
  });
});

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeAssistantService } from "./KnowledgeAssistantService.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nika-kb-test-"));
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

describe("KnowledgeAssistantService", () => {
  it("stores, searches, and deletes entries in persistent knowledge-base", () => {
    const dir = createTempDir();
    const svc = new KnowledgeAssistantService(dir);

    const added = svc.addKnowledge({
      title: "Setup Webcam DirectShow",
      content: "Gunakan ffmpeg -f dshow dengan -vcodec mjpeg pada resolusi 1280x720 agar stabil.",
      tags: ["webcam", "ffmpeg"],
      source: "internal-notes"
    });
    expect(added.id).toMatch(/^kb_/);

    // Reload from disk to verify persistence
    const svcReloaded = new KnowledgeAssistantService(dir);
    const found = svcReloaded.searchKnowledge("mjpeg webcam");
    expect(found).toHaveLength(1);
    expect(found[0].title).toBe("Setup Webcam DirectShow");

    expect(svcReloaded.deleteKnowledge(added.id)).toBe(true);
    expect(svcReloaded.listKnowledge()).toHaveLength(0);
  });

  it("reads text and strips html documents safely with truncation", async () => {
    const dir = createTempDir();
    const svc = new KnowledgeAssistantService(dir);
    const htmlPath = path.join(dir, "sample.html");
    fs.writeFileSync(
      htmlPath,
      "<html><head><style>body{color:red}</style></head><body><h1>Judul</h1><p>Isi dokumen penting.</p></body></html>",
      "utf-8"
    );

    const doc = await svc.readDocument(htmlPath, 50, 0);
    expect(doc.extractor).toBe("html-stripped");
    expect(doc.content).toContain("Judul Isi dokumen penting.");
    expect(doc.truncated).toBe(false);
  });
});

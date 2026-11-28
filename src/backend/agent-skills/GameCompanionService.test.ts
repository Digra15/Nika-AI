import { describe, expect, it } from "vitest";
import { GameCompanionService } from "./GameCompanionService.js";

describe("GameCompanionService", () => {
  it("tracks game state updates and maps event reactions", () => {
    const svc = new GameCompanionService();
    const updated = svc.updateState({
      gameTitle: "Elden Ring",
      phase: "boss",
      playerStatus: "HP 35%",
      lastEvent: "Boss phase 2"
    });
    expect(updated.gameTitle).toBe("Elden Ring");
    expect(updated.phase).toBe("boss");

    const winReact = svc.mapEventReaction("victory");
    expect(winReact.emotion).toBe("laugh");
    expect(winReact.gesture).toBe("cheer");

    const loseReact = svc.mapEventReaction("defeat");
    expect(loseReact.emotion).toBe("sad");
  });

  it("rejects unsupported game keys safely", async () => {
    const svc = new GameCompanionService();
    const res = await svc.sendGameInput({ action: "key_tap", key: "INVALID_KEY" });
    expect(res.ok).toBe(false);
    expect(String(res.error)).toContain("Unsupported game key");
  });
});

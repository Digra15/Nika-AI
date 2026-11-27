import { describe, expect, it } from "vitest";
import { SpriteController } from "./AvatarController.js";

describe("AvatarController (5 avatar skills)", () => {
  it("computes lip-sync stages from audio metrics", () => {
    const ctrl = new SpriteController();
    expect(ctrl.lipSync.getMouthStageIndex(0.1)).toBeNull();
    expect(ctrl.lipSync.getMouthStageIndex(0.3)).toBe(0);
    expect(ctrl.lipSync.getMouthStageIndex(0.55)).toBe(1);
    expect(ctrl.lipSync.getMouthStageIndex(0.9)).toBe(2);
  });

  it("drives expression blush and suppresses blink on laugh", () => {
    const ctrl = new SpriteController();
    expect(ctrl.expression.shouldBlink("laugh")).toBe(false);
    expect(ctrl.expression.shouldBlink("neutral")).toBe(true);
    expect(ctrl.expression.resolveBlushIntensity("happy")).toBeGreaterThan(0.4);
  });

  it("applies gesture offsets when gesture-controller is triggered", () => {
    const ctrl = new SpriteController();
    ctrl.gesture.trigger("cheer", 2000);
    const targets = ctrl.emotionAnim.computeTargets({
      t: 1.0,
      emotion: "happy",
      avatarState: "idle",
      pointer: { x: 0, y: 0 },
      mouth: { volume: 0, aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 },
      lipSync: ctrl.lipSync,
      expression: ctrl.expression,
      gesture: ctrl.gesture,
      nowMs: performance.now()
    });
    expect(Math.abs(targets.leftArmRot)).toBeGreaterThan(0.05);
  });

  it("computes eye tracking and eyebrow offsets", () => {
    const ctrl = new SpriteController();
    const targets = ctrl.emotionAnim.computeTargets({
      t: 1.0,
      emotion: "surprised",
      avatarState: "idle",
      pointer: { x: 0.8, y: -0.5 },
      mouth: { volume: 0, aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 },
      lipSync: ctrl.lipSync,
      expression: ctrl.expression,
      gesture: ctrl.gesture,
      nowMs: performance.now()
    });
    expect(targets.eyeLookX).toBeGreaterThan(3);
    expect(targets.browY).toBeLessThan(0);
  });
});

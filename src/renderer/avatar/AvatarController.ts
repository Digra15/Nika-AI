import type { AvatarActivityState, EmotionType, MoodType } from "../../shared/types/index.js";
import type { MouthMetrics } from "../audio/AudioPipeline.js";

export type AvatarGestureType =
  | "none"
  | "nod"
  | "tilt"
  | "cheer"
  | "thinking_pose"
  | "bow";

export interface AvatarFrameTargets {
  bodyY: number;
  bodySX: number;
  bodySY: number;
  headX: number;
  headY: number;
  headRot: number;
  hairWindRot: number;
  hairWindX: number;
  leftArmRot: number;
  rightArmRot: number;
  talkMix: number;
  happyMix: number;
  blushMix: number;
}

/** 1. LipSyncController — maps real-time audio metrics to 4-stage mouth openness */
export class LipSyncController {
  computeTarget(
    isTalking: boolean,
    emotion: EmotionType,
    mouth: MouthMetrics,
    t: number
  ): number {
    if (isTalking) {
      const syllableEnergy = mouth.volume * 0.75 + mouth.aa * 0.45;
      return syllableEnergy > 0.14 ? Math.min(1, (syllableEnergy - 0.1) * 1.45) : 0;
    }
    if (emotion === "laugh") {
      return 0.85 + Math.sin(t * 10) * 0.15;
    }
    if (emotion === "surprised") {
      return 0.7;
    }
    return 0;
  }

  getMouthStageIndex(talkMix: number): number | null {
    if (talkMix < 0.18) return null;
    if (talkMix < 0.42) return 0;
    if (talkMix < 0.72) return 1;
    return 2;
  }
}

/** 2. ExpressionManager — resolves active expression layer, blink rules, and cheek blush */
export class ExpressionManager {
  resolveBlushIntensity(emotion: EmotionType, mood?: MoodType): number {
    if (emotion === "laugh" || emotion === "happy" || mood === "affectionate") return 0.55;
    if (emotion === "surprised") return 0.35;
    return 0.1;
  }

  shouldBlink(emotion: EmotionType): boolean {
    return emotion !== "laugh";
  }
}

/** 3. GestureController — timed expressive body & head gestures */
export class GestureController {
  private activeGesture: AvatarGestureType = "none";
  private expiresAt = 0;

  trigger(gesture: AvatarGestureType, durationMs = 1600): void {
    this.activeGesture = gesture;
    this.expiresAt = performance.now() + durationMs;
  }

  getOffsets(nowMs: number, t: number): {
    headY: number;
    headRot: number;
    bodyY: number;
    leftArmRot: number;
    rightArmRot: number;
  } {
    if (this.activeGesture === "none" || nowMs > this.expiresAt) {
      this.activeGesture = "none";
      return { headY: 0, headRot: 0, bodyY: 0, leftArmRot: 0, rightArmRot: 0 };
    }

    switch (this.activeGesture) {
      case "nod":
        return {
          headY: Math.abs(Math.sin(t * 9)) * 7,
          headRot: 0.02,
          bodyY: 0,
          leftArmRot: 0,
          rightArmRot: 0
        };
      case "tilt":
        return {
          headY: -2,
          headRot: 0.1,
          bodyY: 0,
          leftArmRot: 0.03,
          rightArmRot: -0.02
        };
      case "cheer":
        return {
          headY: Math.abs(Math.sin(t * 6)) * -6,
          headRot: Math.sin(t * 6) * 0.04,
          bodyY: Math.abs(Math.sin(t * 6)) * -5,
          leftArmRot: -0.18 + Math.sin(t * 8) * 0.06,
          rightArmRot: 0.18 - Math.sin(t * 8) * 0.06
        };
      case "thinking_pose":
        return {
          headY: -2,
          headRot: 0.08,
          bodyY: 0,
          leftArmRot: 0.04,
          rightArmRot: 0.14
        };
      case "bow":
        return {
          headY: 10,
          headRot: -0.06,
          bodyY: 6,
          leftArmRot: 0.04,
          rightArmRot: -0.04
        };
      default:
        return { headY: 0, headRot: 0, bodyY: 0, leftArmRot: 0, rightArmRot: 0 };
    }
  }
}

/** 4. EmotionAnimationController — posture & motion driven by emotion and activity state */
export class EmotionAnimationController {
  computeTargets(params: {
    t: number;
    emotion: EmotionType;
    avatarState: AvatarActivityState;
    mood?: MoodType;
    pointer: { x: number; y: number };
    mouth: MouthMetrics;
    lipSync: LipSyncController;
    expression: ExpressionManager;
    gesture: GestureController;
    nowMs: number;
  }): AvatarFrameTargets {
    const {
      t,
      emotion,
      avatarState,
      mood,
      pointer,
      mouth,
      lipSync,
      expression,
      gesture,
      nowMs
    } = params;

    const isTalking = avatarState === "talking" || avatarState === "laughing";
    const breath = Math.sin(t * 1.65);
    const headBreath = Math.sin(t * 1.65 - 0.45);

    let bodyY = -breath * 2.2;
    const bodySX = 1 + breath * 0.005;
    let bodySY = 1 + breath * 0.007;

    let headX = pointer.x * 4.5 + Math.sin(t * 0.9) * 1.5;
    let headY = 14 - headBreath * 2.0 + pointer.y * 2.5;
    let headRot = pointer.x * 0.04 + Math.sin(t * 1.1) * 0.012;

    let leftArmRot = 0.02 + Math.sin(t * 1.65 - 0.4) * 0.02;
    let rightArmRot = -0.02 - Math.sin(t * 1.65 - 0.4) * 0.02;

    const hairWindRot =
      Math.sin(t * 2.1) * 0.018 + Math.sin(t * 4.3) * 0.006 - headRot * 0.2;
    const hairWindX = Math.sin(t * 2.1 - 0.5) * 3.0;

    if (isTalking) {
      headY += Math.sin(t * 5.2) * 2.0 - mouth.volume * 3.5;
      headRot += Math.sin(t * 2.7) * 0.025;
      leftArmRot += Math.sin(t * 2.4) * 0.045 + mouth.volume * 0.025;
      rightArmRot += Math.cos(t * 2.1) * 0.045 - mouth.volume * 0.025;
      if (mouth.volume < 0.08) {
        bodySY += 0.005;
        bodyY -= 1.5;
      }
    } else if (avatarState === "listening") {
      headRot += -0.05;
      headY += -2;
    } else if (emotion === "thinking" || avatarState === "thinking") {
      headRot += 0.065;
      headY += -2;
    } else if (emotion === "happy" || emotion === "laugh") {
      bodyY += Math.abs(Math.sin(t * 3.2)) * -4;
      headY += Math.abs(Math.sin(t * 3.2)) * -5;
      headRot += Math.sin(t * 3.2) * 0.03;
    } else if (emotion === "sad") {
      headY += 8;
      headRot += -0.035;
    } else if (emotion === "angry") {
      headX += Math.sin(t * 22) * 2.0;
    } else if (emotion === "surprised") {
      headY += -6;
    }

    const g = gesture.getOffsets(nowMs, t);
    headY += g.headY;
    headRot += g.headRot;
    bodyY += g.bodyY;
    leftArmRot += g.leftArmRot;
    rightArmRot += g.rightArmRot;

    return {
      bodyY,
      bodySX,
      bodySY,
      headX,
      headY,
      headRot,
      hairWindRot,
      hairWindX,
      leftArmRot,
      rightArmRot,
      talkMix: lipSync.computeTarget(isTalking, emotion, mouth, t),
      happyMix: emotion === "happy" && !isTalking ? 1 : 0,
      blushMix: expression.resolveBlushIntensity(emotion, mood)
    };
  }
}

/** 5. SpriteController — coordinates expression, lip-sync, emotion-animation, and gestures */
export class SpriteController {
  readonly lipSync = new LipSyncController();
  readonly expression = new ExpressionManager();
  readonly emotionAnim = new EmotionAnimationController();
  readonly gesture = new GestureController();
}

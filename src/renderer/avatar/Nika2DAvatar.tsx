import React, { useEffect, useRef } from "react";
import type { AvatarActivityState, EmotionType } from "../../shared/types/index";
import type { AudioPipeline } from "../audio/AudioPipeline";
import armsImg from "../assets/avatar/arms.jpg";
import angryImg from "../assets/avatar/angry.jpg";
import backHairImg from "../assets/avatar/back_hair.jpg";
import bangsFrontImg from "../assets/avatar/bangs_front.jpg";
import happyImg from "../assets/avatar/happy.jpg";
import headBlankImg from "../assets/avatar/head_blank.jpg";
import headImg from "../assets/avatar/head.jpg";
import laughImg from "../assets/avatar/laugh.jpg";
import sadImg from "../assets/avatar/sad.jpg";
import surprisedImg from "../assets/avatar/surprised.jpg";
import talkingImg from "../assets/avatar/talking.jpg";
import thinkingImg from "../assets/avatar/thinking.jpg";
import torsoImg from "../assets/avatar/torso.jpg";

interface Nika2DAvatarProps {
  avatarState: AvatarActivityState;
  emotion: EmotionType;
  audioPipeline: AudioPipeline;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

function getAuraColor(emotion: EmotionType, avatarState: AvatarActivityState): string {
  if (avatarState === "listening") return "#22d3ee";
  switch (emotion) {
    case "happy":
    case "laugh":
      return "#c084fc";
    case "sad":
      return "#60a5fa";
    case "angry":
      return "#fb7185";
    case "surprised":
      return "#facc15";
    case "thinking":
      return "#818cf8";
    default:
      return "#a855f7";
  }
}

/**
 * Flood-fills the dark studio background from the outer image border
 * with 2px smooth anti-aliased edge feathering.
 */
function createCutoutCanvas(
  img: HTMLImageElement,
  tolerance = 42,
  extraDarkCheck = false
): HTMLCanvasElement {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const bgR = data[0];
  const bgG = data[1];
  const bgB = data[2];

  const bgMask = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  const isBg = (idx: number): boolean => {
    const o = idx * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const dr = r - bgR;
    const dg = g - bgG;
    const db = b - bgB;
    if (dr * dr + dg * dg + db * db < tolerance * tolerance) return true;
    // Remove darker shadow spots connected to background (e.g. under chin on isolated head)
    if (extraDarkCheck && r < 40 && g < 35 && b < 55) return true;
    return false;
  };

  const pushIfBg = (x: number, y: number) => {
    const idx = y * w + x;
    if (bgMask[idx]) return;
    if (isBg(idx)) {
      bgMask[idx] = 1;
      queue[tail++] = idx;
    }
  };

  for (let x = 0; x < w; x++) {
    pushIfBg(x, 0);
    pushIfBg(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    pushIfBg(0, y);
    pushIfBg(w - 1, y);
  }

  while (head < tail) {
    const idx = queue[head++];
    data[idx * 4 + 3] = 0;

    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) pushIfBg(x - 1, y);
    if (x < w - 1) pushIfBg(x + 1, y);
    if (y > 0) pushIfBg(x, y - 1);
    if (y < h - 1) pushIfBg(x, y + 1);
  }

  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const idx = y * w + x;
      if (bgMask[idx]) continue;
      let bgCount = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (bgMask[(y + dy) * w + (x + dx)]) bgCount++;
        }
      }
      if (bgCount > 0) {
        const alpha = Math.max(0.15, 1 - bgCount * 0.14);
        data[idx * 4 + 3] = Math.round(255 * alpha);
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function cropPart(
  src: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext("2d");
  ctx?.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

/**
 * Builds 3 clean open-mouth stages (small, medium, wide) on top of a skin-matched
 * base so the closed neutral smile line underneath never creates a ghost shadow.
 */
function buildMouthStages(
  headCutout: HTMLCanvasElement,
  talkingCutout: HTMLCanvasElement
): HTMLCanvasElement[] {
  const w = headCutout.width;
  const h = headCutout.height;
  const mw = Math.round(w * 0.11);
  const mh = Math.round(h * 0.065);
  const mx = Math.round(w * 0.5 - mw * 0.5);
  const my = Math.round(h * 0.325 - mh * 0.5);

  // Sample skin color right above and below the mouth from headCutout
  const hCtx = headCutout.getContext("2d");
  let skinR = 252;
  let skinG = 234;
  let skinB = 228;
  if (hCtx) {
    const sample = hCtx.getImageData(Math.round(w * 0.5), Math.round(h * 0.308), 1, 1).data;
    if (sample[3] > 200) {
      skinR = sample[0];
      skinG = sample[1];
      skinB = sample[2];
    }
  }
  const skinColor = `rgb(${skinR}, ${skinG}, ${skinB})`;

  // Extract clean talking mouth patch
  const rawMouth = document.createElement("canvas");
  rawMouth.width = mw;
  rawMouth.height = mh;
  const rmCtx = rawMouth.getContext("2d");
  if (rmCtx) {
    rmCtx.drawImage(talkingCutout, mx, my, mw, mh, 0, 0, mw, mh);
    rmCtx.globalCompositeOperation = "destination-in";
    const mGrad = rmCtx.createRadialGradient(mw * 0.5, mh * 0.5, mw * 0.16, mw * 0.5, mh * 0.5, mw * 0.45);
    mGrad.addColorStop(0, "rgba(0,0,0,1)");
    mGrad.addColorStop(0.7, "rgba(0,0,0,0.95)");
    mGrad.addColorStop(1, "rgba(0,0,0,0)");
    rmCtx.fillStyle = mGrad;
    rmCtx.fillRect(0, 0, mw, mh);
    rmCtx.globalCompositeOperation = "source-over";
  }

  const scalesY = [0.42, 0.72, 1.0];
  const scalesX = [0.88, 0.96, 1.0];

  return scalesY.map((sy, idx) => {
    const stage = document.createElement("canvas");
    stage.width = mw;
    stage.height = mh;
    const ctx = stage.getContext("2d");
    if (!ctx) return stage;

    // 1. Solid feathered skin cover to completely hide the closed smile line underneath
    const coverGrad = ctx.createRadialGradient(
      mw * 0.5,
      mh * 0.5,
      mw * 0.2,
      mw * 0.5,
      mh * 0.5,
      mw * 0.46
    );
    coverGrad.addColorStop(0, skinColor);
    coverGrad.addColorStop(0.72, skinColor);
    coverGrad.addColorStop(1, `rgba(${skinR}, ${skinG}, ${skinB}, 0)`);
    ctx.fillStyle = coverGrad;
    ctx.fillRect(0, 0, mw, mh);

    // 2. Draw scaled open mouth cleanly at full opacity
    ctx.save();
    ctx.translate(mw * 0.5, mh * 0.5);
    ctx.scale(scalesX[idx], sy);
    ctx.drawImage(rawMouth, -mw * 0.5, -mh * 0.5);
    ctx.restore();

    return stage;
  });
}

export const Nika2DAvatar: React.FC<Nika2DAvatarProps> = ({
  avatarState,
  emotion,
  audioPipeline
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const stateRef = useRef({ avatarState, emotion });
  stateRef.current = { avatarState, emotion };

  const rigRef = useRef<{
    ready: boolean;
    w: number;
    h: number;
    torso: HTMLCanvasElement | null;
    backHair: HTMLCanvasElement | null;
    headBlank: HTMLCanvasElement | null;
    bangsFront: HTMLCanvasElement | null;
    head: HTMLCanvasElement | null;
    leftArm: HTMLCanvasElement | null;
    rightArm: HTMLCanvasElement | null;
    mouthStages: HTMLCanvasElement[];
    happy: HTMLCanvasElement | null;
    laugh: HTMLCanvasElement | null;
    surprised: HTMLCanvasElement | null;
    thinking: HTMLCanvasElement | null;
    sad: HTMLCanvasElement | null;
    angry: HTMLCanvasElement | null;
  }>({
    ready: false,
    w: 896,
    h: 1200,
    torso: null,
    backHair: null,
    headBlank: null,
    bangsFront: null,
    head: null,
    leftArm: null,
    rightArm: null,
    mouthStages: [],
    happy: null,
    laugh: null,
    surprised: null,
    thinking: null,
    sad: null,
    angry: null
  });

  useEffect(() => {
    let cancelled = false;
    const sources = [
      torsoImg,
      backHairImg,
      headBlankImg,
      bangsFrontImg,
      headImg,
      armsImg,
      talkingImg,
      happyImg,
      laughImg,
      surprisedImg,
      thinkingImg,
      sadImg,
      angryImg
    ];
    const imgs = sources.map((src) => {
      const im = new Image();
      im.src = src;
      return im;
    });

    Promise.all(
      imgs.map(
        (im) =>
          new Promise<void>((resolve) => {
            if (im.complete) resolve();
            else im.onload = () => resolve();
          })
      )
    ).then(() => {
      if (cancelled) return;
      const [
        imTorso,
        imBackHair,
        imHeadBlank,
        imBangsFront,
        imHead,
        imArms,
        imTalking,
        imHappy,
        imLaugh,
        imSurprised,
        imThinking,
        imSad,
        imAngry
      ] = imgs;

      const torso = createCutoutCanvas(imTorso, 26);
      const backHair = createCutoutCanvas(imBackHair, 42);
      // Fade out upper crown of backHair so only lower neck-level hair peeks behind chin/neck
      const bhCtx = backHair.getContext("2d");
      if (bhCtx) {
        bhCtx.globalCompositeOperation = "destination-out";
        bhCtx.fillStyle = "rgba(0,0,0,1)";
        bhCtx.fillRect(0, 0, backHair.width, backHair.height * 0.29);
        const bhGrad = bhCtx.createLinearGradient(0, backHair.height * 0.29, 0, backHair.height * 0.33);
        bhGrad.addColorStop(0, "rgba(0,0,0,1)");
        bhGrad.addColorStop(1, "rgba(0,0,0,0)");
        bhCtx.fillStyle = bhGrad;
        bhCtx.fillRect(0, backHair.height * 0.29, backHair.width, backHair.height * 0.04);
        bhCtx.globalCompositeOperation = "source-over";
      }
      const headBlank = createCutoutCanvas(imHeadBlank, 42, true);
      const bangsFront = createCutoutCanvas(imBangsFront, 42, true);
      const head = createCutoutCanvas(imHead, 42, true);
      const armsCutout = createCutoutCanvas(imArms, 36);
      const talking = createCutoutCanvas(imTalking, 42);
      const mouthStages = buildMouthStages(head, talking);
      const happy = createCutoutCanvas(imHappy, 42);
      const laugh = createCutoutCanvas(imLaugh, 42, true);
      const surprised = createCutoutCanvas(imSurprised, 42, true);
      const thinking = createCutoutCanvas(imThinking, 42, true);
      const sad = createCutoutCanvas(imSad, 42, true);
      const angry = createCutoutCanvas(imAngry, 42, true);

      const aw = armsCutout.width;
      const ah = armsCutout.height;
      const leftArm = cropPart(armsCutout, 0, 0, Math.floor(aw * 0.5), ah);
      const rightArm = cropPart(armsCutout, Math.floor(aw * 0.5), 0, Math.ceil(aw * 0.5), ah);

      rigRef.current = {
        ready: true,
        w: torso.width,
        h: torso.height,
        torso,
        backHair,
        headBlank,
        bangsFront,
        head,
        leftArm,
        rightArm,
        mouthStages,
        happy,
        laugh,
        surprised,
        thinking,
        sad,
        angry
      };
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      pointerRef.current = {
        x: Math.max(-1, Math.min(1, nx)),
        y: Math.max(-1, Math.min(1, ny))
      };
    };

    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const anim = {
      t: 0,
      blink: 0,
      blinkTimer: 0,
      nextBlink: 2.8,
      bodyY: 0,
      bodySX: 1,
      bodySY: 1,
      headX: 0,
      headY: 0,
      headRot: 0,
      hairWindRot: 0,
      hairWindX: 0,
      leftArmRot: 0,
      rightArmRot: 0,
      talkMix: 0,
      happyMix: 0,
      volume: 0
    };

    const drawSparkle = (
      ctx: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      r: number,
      color: string,
      rot = 0
    ) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 0.18, -r * 0.18, r, 0);
      ctx.quadraticCurveTo(r * 0.18, r * 0.18, 0, r);
      ctx.quadraticCurveTo(-r * 0.18, r * 0.18, -r, 0);
      ctx.quadraticCurveTo(-r * 0.18, -r * 0.18, 0, -r);
      ctx.fill();
      ctx.restore();
    };

    const drawHeadAccents = (
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number,
      t: number,
      emo: EmotionType,
      act: AvatarActivityState
    ) => {
      if (act === "listening") {
        // Animated cyber listening rings & floating equalizer bars
        ctx.save();
        ctx.strokeStyle = "#22d3ee";
        ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) {
          const phase = (t * 1.4 + i * 0.33) % 1;
          ctx.globalAlpha = (1 - phase) * 0.65;
          ctx.beginPath();
          ctx.arc(w * 0.5, h * 0.21, w * (0.26 + phase * 0.12), Math.PI * 1.15, Math.PI * 1.85);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (emo === "happy" || emo === "laugh") {
        const s1 = 16 + Math.sin(t * 5) * 4;
        const s2 = 11 + Math.cos(t * 4.5) * 3;
        drawSparkle(ctx, w * 0.74, h * 0.11 + Math.sin(t * 3.5) * 8, s1, "#f0abfc", t * 1.2);
        drawSparkle(ctx, w * 0.25, h * 0.13 + Math.cos(t * 3.2) * 7, s2, "#22d3ee", -t * 1.4);
        ctx.save();
        ctx.fillStyle = "#c084fc";
        ctx.shadowColor = "#a855f7";
        ctx.shadowBlur = 10;
        ctx.font = "bold 28px sans-serif";
        ctx.globalAlpha = 0.75 + Math.sin(t * 4) * 0.25;
        ctx.fillText("♪", w * 0.77, h * 0.06 - ((t * 18) % 24));
        ctx.restore();
      } else if (emo === "angry") {
        const pulse = 1 + Math.sin(t * 14) * 0.12;
        const shakeX = Math.sin(t * 28) * 2.5;
        ctx.save();
        ctx.translate(w * 0.71 + shakeX, h * 0.11);
        ctx.scale(pulse, pulse);
        ctx.strokeStyle = "#fb7185";
        ctx.shadowColor = "#f43f5e";
        ctx.shadowBlur = 12;
        ctx.lineWidth = 4.5;
        ctx.lineCap = "round";
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1]
        ]) {
          ctx.beginPath();
          ctx.moveTo(sx * 16, sy * 4);
          ctx.quadraticCurveTo(sx * 5, sy * 5, sx * 4, sy * 16);
          ctx.stroke();
        }
        ctx.restore();
      } else if (emo === "surprised") {
        const bounce = Math.abs(Math.sin(t * 8)) * -10;
        ctx.save();
        ctx.fillStyle = "#facc15";
        ctx.shadowColor = "#eab308";
        ctx.shadowBlur = 14;
        ctx.font = "900 50px sans-serif";
        ctx.fillText("!!", w * 0.71, h * 0.13 + bounce);
        ctx.restore();
      } else if (emo === "thinking" || act === "thinking") {
        // Rising bubbles + glowing pulsing lightbulb with radiating light rays
        ctx.save();
        const b1 = Math.sin(t * 3.4) * 4;
        const b2 = Math.sin(t * 3.4 - 0.8) * 5;
        ctx.fillStyle = "#a5b4fc";
        ctx.shadowColor = "#818cf8";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(w * 0.685, h * 0.145 + b1, 5, 0, Math.PI * 2);
        ctx.arc(w * 0.715, h * 0.12 + b2, 7.5, 0, Math.PI * 2);
        ctx.fill();

        const bx = w * 0.765;
        const by = h * 0.08 + Math.sin(t * 2.8) * 5;
        const glowPulse = 0.75 + Math.sin(t * 5.5) * 0.25;

        // Radiating light rays
        ctx.strokeStyle = "#fde047";
        ctx.shadowColor = "#facc15";
        ctx.shadowBlur = 18 * glowPulse;
        ctx.lineWidth = 3.2;
        ctx.lineCap = "round";
        ctx.globalAlpha = glowPulse;
        for (let i = 0; i < 6; i++) {
          const ang = -Math.PI * 0.9 + (i / 5) * Math.PI * 1.1 + Math.sin(t * 2) * 0.08;
          const r1 = 22;
          const r2 = 31 + Math.sin(t * 6 + i) * 3;
          ctx.beginPath();
          ctx.moveTo(bx + Math.cos(ang) * r1, by + Math.sin(ang) * r1);
          ctx.lineTo(bx + Math.cos(ang) * r2, by + Math.sin(ang) * r2);
          ctx.stroke();
        }

        // Lightbulb glass & base
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fef08a";
        ctx.beginPath();
        ctx.arc(bx, by, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(bx - 4, by - 4, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#64748b";
        ctx.fillRect(bx - 6, by + 12, 12, 7);
        ctx.restore();
      } else if (emo === "sad") {
        ctx.save();
        ctx.fillStyle = "#7dd3fc";
        ctx.shadowColor = "#38bdf8";
        ctx.shadowBlur = 8;
        for (let i = 0; i < 2; i++) {
          const dropY = ((t * 32 + i * 24) % 44);
          ctx.globalAlpha = 1 - dropY / 44;
          ctx.beginPath();
          ctx.ellipse(w * (0.31 + i * 0.38), h * 0.09 + dropY, 3.5, 6, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    };

    const renderFrame = (now: number) => {
      const delta = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      anim.t += delta;

      const canvas = canvasRef.current;
      const rig = rigRef.current;
      if (
        !canvas ||
        !rig.ready ||
        !rig.torso ||
        !rig.backHair ||
        !rig.headBlank ||
        !rig.bangsFront ||
        !rig.head ||
        !rig.leftArm ||
        !rig.rightArm ||
        rig.mouthStages.length === 0 ||
        !rig.happy
      ) {
        rafId = requestAnimationFrame(renderFrame);
        return;
      }

      if (canvas.width !== rig.w || canvas.height !== rig.h) {
        canvas.width = rig.w;
        canvas.height = rig.h;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafId = requestAnimationFrame(renderFrame);
        return;
      }

      const { avatarState: act, emotion: emo } = stateRef.current;
      const mouth = audioPipeline.getMouthMetrics();
      const isTalking = act === "talking" || act === "laughing";

      // Blinking
      anim.blinkTimer += delta;
      let targetBlink = 0;
      if (anim.blinkTimer > anim.nextBlink) {
        const elapsed = anim.blinkTimer - anim.nextBlink;
        if (elapsed < 0.14) {
          targetBlink = Math.sin((elapsed / 0.14) * Math.PI);
        } else {
          anim.blinkTimer = 0;
          anim.nextBlink = 2.4 + Math.random() * 2.8;
        }
      }
      anim.blink = targetBlink;

      // Gentle, natural breathing wave (~3.8s)
      const breath = Math.sin(anim.t * 1.65);
      const headBreath = Math.sin(anim.t * 1.65 - 0.45);

      // 4-stage lip-sync level (0 = closed, 1 = small, 2 = medium, 3 = wide)
      // Uses volume + aa so mouth closes cleanly on pauses between syllables
      let targetTalk = 0;
      if (isTalking) {
        const syllableEnergy = mouth.volume * 0.75 + mouth.aa * 0.45;
        targetTalk = syllableEnergy > 0.14 ? Math.min(1, (syllableEnergy - 0.1) * 1.45) : 0;
      } else if (emo === "laugh") {
        targetTalk = 0.85 + Math.sin(anim.t * 10) * 0.15;
      } else if (emo === "surprised") {
        targetTalk = 0.7;
      }

      const targetHappy = emo === "happy" && !isTalking ? 1 : 0;

      const px = pointerRef.current.x;
      const py = pointerRef.current.y;

      // Seat head naturally on neck (+14px) with subtle breathing so neck never stretches
      let targetBodyY = -breath * 2.2;
      let targetBodySX = 1 + breath * 0.005;
      let targetBodySY = 1 + breath * 0.007;

      let targetHeadX = px * 4.5 + Math.sin(anim.t * 0.9) * 1.5;
      let targetHeadY = 14 - headBreath * 2.0 + py * 2.5;
      let targetHeadRot = px * 0.04 + Math.sin(anim.t * 1.1) * 0.012;

      // Arms subtle natural sway (no waving)
      let targetLeftArmRot = 0.02 + Math.sin(anim.t * 1.65 - 0.4) * 0.02;
      let targetRightArmRot = -0.02 - Math.sin(anim.t * 1.65 - 0.4) * 0.02;

      // Wind in back hair
      const targetHairWindRot =
        Math.sin(anim.t * 2.1) * 0.018 + Math.sin(anim.t * 4.3) * 0.006 - targetHeadRot * 0.2;
      const targetHairWindX = Math.sin(anim.t * 2.1 - 0.5) * 3.0;

      if (isTalking) {
        targetHeadY += Math.sin(anim.t * 5.2) * 2.0 - mouth.volume * 3.5;
        targetHeadRot += Math.sin(anim.t * 2.7) * 0.025;
        targetLeftArmRot += Math.sin(anim.t * 2.4) * 0.045 + mouth.volume * 0.025;
        targetRightArmRot += Math.cos(anim.t * 2.1) * 0.045 - mouth.volume * 0.025;
        if (mouth.volume < 0.08) {
          targetBodySY += 0.005;
          targetBodyY -= 1.5;
        }
      } else if (act === "listening") {
        targetHeadRot += -0.05;
        targetHeadY += -2;
      } else if (emo === "thinking" || act === "thinking") {
        targetHeadRot += 0.065;
        targetHeadY += -2;
      } else if (emo === "happy" || emo === "laugh") {
        targetBodyY += Math.abs(Math.sin(anim.t * 3.2)) * -4;
        targetHeadY += Math.abs(Math.sin(anim.t * 3.2)) * -5;
        targetHeadRot += Math.sin(anim.t * 3.2) * 0.03;
      } else if (emo === "sad") {
        targetHeadY += 8;
        targetHeadRot += -0.035;
      } else if (emo === "angry") {
        targetHeadX += Math.sin(anim.t * 22) * 2.0;
      } else if (emo === "surprised") {
        targetHeadY += -6;
      }

      anim.bodyY = lerp(anim.bodyY, targetBodyY, delta * 7);
      anim.bodySX = lerp(anim.bodySX, targetBodySX, delta * 7);
      anim.bodySY = lerp(anim.bodySY, targetBodySY, delta * 7);
      anim.headX = lerp(anim.headX, targetHeadX, delta * 8);
      anim.headY = lerp(anim.headY, targetHeadY, delta * 8);
      anim.headRot = lerp(anim.headRot, targetHeadRot, delta * 8);
      anim.hairWindRot = lerp(anim.hairWindRot, targetHairWindRot, delta * 6);
      anim.hairWindX = lerp(anim.hairWindX, targetHairWindX, delta * 6);
      anim.leftArmRot = lerp(anim.leftArmRot, targetLeftArmRot, delta * 7);
      anim.rightArmRot = lerp(anim.rightArmRot, targetRightArmRot, delta * 7);
      anim.talkMix = lerp(anim.talkMix, targetTalk, delta * 34);
      anim.happyMix = lerp(anim.happyMix, targetHappy, delta * 12);
      anim.volume = lerp(anim.volume, mouth.volume, delta * 18);

      ctx.clearRect(0, 0, rig.w, rig.h);

      const neckPivotX = rig.w * 0.5;
      const neckPivotY = rig.h * 0.36;

      // 1. Back Hair Layer (behind torso & head, sways in wind from crown pivot)
      ctx.save();
      ctx.translate(neckPivotX + anim.headX, neckPivotY + anim.headY);
      ctx.rotate(anim.headRot);
      ctx.translate(-neckPivotX, -neckPivotY);

      ctx.translate(rig.w * 0.5 + anim.hairWindX, rig.h * 0.14);
      ctx.rotate(anim.hairWindRot);
      ctx.translate(-rig.w * 0.5, -rig.h * 0.14);
      ctx.drawImage(rig.backHair, 0, 0);
      ctx.restore();

      // 2. Torso & Arms Group (breathing chest + articulated shoulders)
      ctx.save();
      ctx.translate(rig.w * 0.5, rig.h);
      ctx.scale(anim.bodySX, anim.bodySY);
      ctx.translate(-rig.w * 0.5, -rig.h + anim.bodyY);

      // 2a. Left & Right Arms positioned under torso shoulder caps, proportional to full body
      const armScale = 0.72;
      const leftShoulderX = rig.w * 0.272;
      const rightShoulderX = rig.w * 0.728;
      const shoulderY = rig.h * 0.495;

      // Left arm (shoulder joint tucked under torso shoulder cap)
      ctx.save();
      ctx.translate(leftShoulderX, shoulderY);
      ctx.rotate(anim.leftArmRot + 0.14);
      ctx.scale(armScale, armScale);
      ctx.drawImage(rig.leftArm, -rig.leftArm.width * 0.44, -rig.leftArm.height * 0.16);
      ctx.restore();

      // Right arm (clean full-arm shoulder joint)
      ctx.save();
      ctx.translate(rightShoulderX, shoulderY);
      ctx.rotate(anim.rightArmRot - 0.14);
      ctx.scale(armScale, armScale);
      ctx.drawImage(rig.rightArm, -rig.rightArm.width * 0.56, -rig.rightArm.height * 0.16);
      ctx.restore();

      // 2b. Torso + Neck on top of shoulder joints
      ctx.drawImage(rig.torso, 0, 0);
      ctx.restore();

      // 3. Head PSD Stack: Blank Face Base -> Facial Expression -> Blink -> Mouth -> Front Bangs on TOP
      ctx.save();
      ctx.translate(neckPivotX + anim.headX, neckPivotY + anim.headY);
      ctx.rotate(anim.headRot);
      ctx.translate(-neckPivotX, -neckPivotY);

      // 3a. Blank face base (skin + headphones + outer hair)
      ctx.drawImage(rig.headBlank, 0, 0);

      // 3b. Active expression face layer (drawn underneath bangsFront)
      const activeHead =
        emo === "laugh" && rig.laugh
          ? rig.laugh
          : emo === "surprised" && rig.surprised
            ? rig.surprised
            : emo === "thinking" && rig.thinking
              ? rig.thinking
              : emo === "sad" && rig.sad
                ? rig.sad
                : emo === "angry" && rig.angry
                  ? rig.angry
                  : rig.head;
      ctx.drawImage(activeHead, 0, 0);

      // 3c. Happy Face Expression (clean inner-face blend)
      if (anim.happyMix > 0.03) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(rig.w * 0.5, rig.h * 0.285, rig.w * 0.145, rig.h * 0.075, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.globalAlpha = anim.happyMix;
        ctx.drawImage(rig.happy, 0, 0);
        ctx.restore();
      }

      // 3d. Natural Blink (using headBlank skin + clean curved lash UNDERNEATH bangsFront!)
      if (anim.blink > 0.05 && emo !== "laugh") {
        const eyeY = rig.h * 0.258;
        const leftEyeX = rig.w * 0.408;
        const rightEyeX = rig.w * 0.592;
        const eyeRx = rig.w * 0.045;
        const eyeRy = rig.h * 0.03;

        for (const cx of [leftEyeX, rightEyeX]) {
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(cx, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
          ctx.clip();
          const lidBottom = eyeY - eyeRy + anim.blink * (eyeRy * 2.05);
          ctx.beginPath();
          ctx.rect(cx - eyeRx, eyeY - eyeRy, eyeRx * 2, lidBottom - (eyeY - eyeRy));
          ctx.clip();
          ctx.drawImage(rig.headBlank, 0, 0);
          ctx.strokeStyle = "#31164d";
          ctx.lineWidth = 4.5;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(cx - eyeRx * 0.82, lidBottom - 2);
          ctx.quadraticCurveTo(cx, lidBottom + 4 * anim.blink, cx + eyeRx * 0.82, lidBottom - 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // 3e. 4-Stage Clean Lip-Sync Mouth (zero ghosting!)
      if (anim.talkMix >= 0.18 && rig.mouthStages.length === 3) {
        const stageIdx = anim.talkMix < 0.42 ? 0 : anim.talkMix < 0.72 ? 1 : 2;
        const stageCanvas = rig.mouthStages[stageIdx];
        const mx = Math.round(rig.w * 0.5 - stageCanvas.width * 0.5);
        const my = Math.round(rig.h * 0.325 - stageCanvas.height * 0.5);
        ctx.drawImage(stageCanvas, mx, my);
      }

      // 3f. Front Bangs + 'N' Hairclip ON TOP of eyes & eyebrows (with gentle wind sway)
      ctx.save();
      ctx.translate(rig.w * 0.5 + anim.hairWindX * 0.35, rig.h * 0.11);
      ctx.rotate(anim.hairWindRot * 0.25);
      ctx.translate(-rig.w * 0.5, -rig.h * 0.11);
      ctx.drawImage(rig.bangsFront, 0, 0);
      ctx.restore();

      // 3g. Lively Animated Vector Head Accents
      drawHeadAccents(ctx, rig.w, rig.h, anim.t, emo, act);

      ctx.restore();
      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [audioPipeline]);

  const aura = getAuraColor(emotion, avatarState);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `radial-gradient(circle at 50% 48%, ${aura}30 0%, #0b0714 70%)`,
        position: "relative",
        overflow: "hidden",
        userSelect: "none"
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          maxHeight: "96%",
          maxWidth: "96%",
          objectFit: "contain",
          filter: `drop-shadow(0 0 26px ${aura}55)`
        }}
      />
    </div>
  );
};

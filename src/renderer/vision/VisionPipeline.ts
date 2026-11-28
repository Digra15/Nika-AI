export type CameraResolution = "auto" | "320x240" | "640x360" | "640x480" | "1280x720";

export interface CameraStartOptions {
  deviceId?: string;
  resolution?: CameraResolution;
  onFrame: (base64Jpeg: string) => void;
  onTrackEnded?: (reason: string) => void;
  onStreamReady?: (stream: MediaStream) => void;
}

const RESOLUTION_PRESETS: Record<
  Exclude<CameraResolution, "auto">,
  { width: number; height: number; fps: number }
> = {
  "1280x720": { width: 1280, height: 720, fps: 30 },
  "640x480": { width: 640, height: 480, fps: 30 },
  "640x360": { width: 640, height: 360, fps: 30 },
  "320x240": { width: 320, height: 240, fps: 15 }
};

const SAFE_FALLBACK_LADDER: CameraResolution[] = ["1280x720", "640x360", "640x480", "320x240"];

export class VisionPipeline {
  private stream: MediaStream | null = null;
  private startingPromise: Promise<MediaStream> | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private diffCanvasEl: HTMLCanvasElement | null = null;
  private lastSignature: Uint8Array | null = null;
  private timer: number | null = null;

  private buildConstraints(
    deviceId?: string,
    resolution: CameraResolution = "1280x720",
    strict = true
  ): MediaTrackConstraints {
    const base: MediaTrackConstraints = {};
    if (deviceId && deviceId !== "default") {
      base.deviceId = strict ? { exact: deviceId } : { ideal: deviceId };
    }
    if (resolution !== "auto") {
      const preset = RESOLUTION_PRESETS[resolution];
      base.width = strict ? { exact: preset.width } : { ideal: preset.width };
      base.height = strict ? { exact: preset.height } : { ideal: preset.height };
      base.frameRate = { ideal: preset.fps, max: 30 };
    }
    return base;
  }

  private async openStreamWithFallback(
    deviceId?: string,
    requested: CameraResolution = "1280x720"
  ): Promise<{ stream: MediaStream; resolution: CameraResolution }> {
    const candidates: CameraResolution[] =
      requested === "auto"
        ? ["1280x720", "640x360", "640x480", "320x240", "auto"]
        : [requested, ...SAFE_FALLBACK_LADDER.filter((r) => r !== requested), "auto"];

    let lastErr: unknown;
    for (const res of candidates) {
      if (res === "auto") {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          return { stream, resolution: "auto" };
        } catch (err) {
          lastErr = err;
          continue;
        }
      }
      for (const strict of [true, false]) {
        try {
          const constraints = this.buildConstraints(deviceId, res, strict);
          const stream = await navigator.mediaDevices.getUserMedia({
            video: constraints,
            audio: false
          });
          return { stream, resolution: res };
        } catch (err) {
          lastErr = err;
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "Webcam gagal dibuka"));
  }

  async startCamera(opts: CameraStartOptions): Promise<MediaStream> {
    if (this.stream) {
      return this.stream;
    }
    if (this.startingPromise) {
      return this.startingPromise;
    }

    this.startingPromise = this.startCameraInternal(opts, 0).finally(() => {
      this.startingPromise = null;
    });
    return this.startingPromise;
  }

  private async startCameraInternal(
    opts: CameraStartOptions,
    retryStep: number
  ): Promise<MediaStream> {
    const requestedRes = opts.resolution ?? "1280x720";
    const { stream, resolution: activeRes } = await this.openStreamWithFallback(
      opts.deviceId,
      requestedRes
    );

    const startedAt = Date.now();
    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.onended = () => {
        const elapsed = Date.now() - startedAt;
        this.stopCamera();
        const nextFallback = SAFE_FALLBACK_LADDER.find((r) => r !== activeRes);
        if (retryStep < SAFE_FALLBACK_LADDER.length && elapsed < 3500 && nextFallback) {
          const fallbackRes = SAFE_FALLBACK_LADDER[retryStep] ?? nextFallback;
          void this.startCameraInternal({ ...opts, resolution: fallbackRes }, retryStep + 1).catch(
            (err) => {
              const msg = err instanceof Error ? err.message : String(err);
              opts.onTrackEnded?.(`Webcam langsung mati (${msg}).`);
            }
          );
          return;
        }
        opts.onTrackEnded?.(
          `Webcam terputus (resolusi ${activeRes}). Coba pilih 320x240 atau 640x360 di Pengaturan > Tampilan.`
        );
      };
    }

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    // Keep video element in DOM (1x1 hidden) so Chromium/Electron never suspends frame decoding
    video.style.position = "fixed";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    video.style.left = "-9999px";
    document.body.appendChild(video);

    video.srcObject = stream;
    await new Promise<void>((resolve) => {
      if (video.readyState >= 1) {
        resolve();
        return;
      }
      video.onloadedmetadata = () => resolve();
      window.setTimeout(resolve, 1200);
    });
    await video.play().catch(() => {});
    this.videoEl = video;

    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const scale = vw > 640 ? 640 / vw : 1;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(160, Math.round(vw * scale));
    canvas.height = Math.max(120, Math.round(vh * scale));
    this.canvasEl = canvas;

    const diffCanvas = document.createElement("canvas");
    diffCanvas.width = 16;
    diffCanvas.height = 16;
    this.diffCanvasEl = diffCanvas;

    const captureIfChanged = (force = false) => {
      if (!this.videoEl || !this.canvasEl || !this.diffCanvasEl) return;
      if (this.videoEl.readyState < 2) return;

      const dCtx = this.diffCanvasEl.getContext("2d");
      if (dCtx) {
        dCtx.drawImage(this.videoEl, 0, 0, 16, 16);
        const data = dCtx.getImageData(0, 0, 16, 16).data;
        const sig = new Uint8Array(256);
        let diffSum = 0;
        for (let i = 0; i < 256; i++) {
          const lum = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
          sig[i] = lum;
          if (this.lastSignature) {
            diffSum += Math.abs(lum - this.lastSignature[i]);
          }
        }
        const meanDiff = diffSum / 256;
        if (!force && this.lastSignature && meanDiff < 3.5) {
          return;
        }
        this.lastSignature = sig;
      }

      const ctx = this.canvasEl.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(this.videoEl, 0, 0, this.canvasEl.width, this.canvasEl.height);
      const dataUrl = this.canvasEl.toDataURL("image/jpeg", 0.78);
      const base64 = dataUrl.split(",")[1] || "";
      if (base64) {
        opts.onFrame(base64);
      }
    };

    window.setTimeout(() => captureIfChanged(true), 300);
    this.timer = window.setInterval(() => captureIfChanged(false), 2500);
    opts.onStreamReady?.(stream);
    return stream;
  }

  stopCamera(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = null;
    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl.remove();
      this.videoEl = null;
    }
    this.canvasEl = null;
    this.diffCanvasEl = null;
    this.lastSignature = null;
  }

  dispose(): void {
    this.stopCamera();
  }
}

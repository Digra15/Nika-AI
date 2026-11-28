export interface CameraStartOptions {
  deviceId?: string;
  resolution?: "auto" | "640x480" | "1280x720";
  onFrame: (base64Jpeg: string) => void;
  onTrackEnded?: (reason: string) => void;
}

export class VisionPipeline {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private diffCanvasEl: HTMLCanvasElement | null = null;
  private lastSignature: Uint8Array | null = null;
  private timer: number | null = null;

  private buildConstraints(
    deviceId?: string,
    resolution: "auto" | "640x480" | "1280x720" = "640x480"
  ): MediaTrackConstraints {
    const base: MediaTrackConstraints = {};
    if (deviceId && deviceId !== "default") {
      base.deviceId = { ideal: deviceId };
    }
    if (resolution === "640x480") {
      base.width = { ideal: 640 };
      base.height = { ideal: 480 };
    } else if (resolution === "1280x720") {
      base.width = { ideal: 1280 };
      base.height = { ideal: 720 };
    }
    return base;
  }

  async startCamera(opts: CameraStartOptions): Promise<MediaStream> {
    if (this.stream) {
      return this.stream;
    }

    let stream: MediaStream;
    try {
      const constraints = this.buildConstraints(opts.deviceId, opts.resolution);
      stream = await navigator.mediaDevices.getUserMedia({
        video: Object.keys(constraints).length > 0 ? constraints : true,
        audio: false
      });
    } catch {
      // Fallback to bare { video: true } if webcam rejects resolution or deviceId constraints
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    this.stream = stream;
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.onended = () => {
        this.stopCamera();
        opts.onTrackEnded?.("Webcam terputus atau dipakai aplikasi lain.");
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
    return stream;
  }

  stopCamera(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
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

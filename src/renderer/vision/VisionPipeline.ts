export class VisionPipeline {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private diffCanvasEl: HTMLCanvasElement | null = null;
  private lastSignature: Uint8Array | null = null;
  private timer: number | null = null;

  async startCamera(onFrame: (base64Jpeg: string) => void): Promise<MediaStream> {
    if (this.stream) {
      return this.stream;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false
    });
    this.stream = stream;

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    this.videoEl = video;

    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
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
        onFrame(base64);
      }
    };

    // Immediate first frame + smart 2.5s change-gated loop
    window.setTimeout(() => captureIfChanged(true), 250);
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

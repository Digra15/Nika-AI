import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { Logger } from "../core/logging/Logger.js";

export type NativeCameraResolution = "auto" | "320x240" | "640x360" | "640x480" | "1280x720";

export interface NativeCameraStartOptions {
  deviceName?: string;
  resolution?: NativeCameraResolution;
  onFrame: (base64Jpeg: string) => void;
  onError?: (reason: string) => void;
}

const PRESET_PROFILES: Record<
  Exclude<NativeCameraResolution, "auto">,
  Array<{ size: string; fps: number }>
> = {
  "1280x720": [
    { size: "1280x720", fps: 30 },
    { size: "1280x720", fps: 15 }
  ],
  "640x360": [
    { size: "640x360", fps: 30 },
    { size: "640x360", fps: 15 }
  ],
  "640x480": [
    { size: "640x480", fps: 30 },
    { size: "640x480", fps: 15 }
  ],
  "320x240": [{ size: "320x240", fps: 15 }]
};

/**
 * Extracts DirectShow video device names from `ffmpeg -list_devices true -f dshow -i dummy` stderr output.
 */
export function parseDirectShowVideoDevices(stderr: string): string[] {
  const devices: string[] = [];
  const lines = stderr.split(/\r?\n/);
  for (const line of lines) {
    // Modern ffmpeg prints: [dshow @ ...] "Device Name" (video)
    const match = line.match(/"([^"]+)"\s+\(video\)/i);
    if (match?.[1] && !devices.includes(match[1])) {
      devices.push(match[1]);
    }
  }
  return devices;
}

/**
 * Incremental JPEG SOI (0xFF 0xD8) .. EOI (0xFF 0xD9) parser for ffmpeg mjpeg pipe output.
 */
export class JpegStreamParser {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer, onJpeg: (jpeg: Buffer) => void): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    while (true) {
      const start = this.buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start === -1) {
        this.buffer = Buffer.alloc(0);
        return;
      }
      if (start > 0) {
        this.buffer = this.buffer.subarray(start);
      }
      const end = this.buffer.indexOf(Buffer.from([0xff, 0xd9]), 2);
      if (end === -1) {
        return;
      }
      const frame = this.buffer.subarray(0, end + 2);
      this.buffer = this.buffer.subarray(end + 2);
      onJpeg(frame);
    }
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

export class NativeCameraService {
  private readonly logger = new Logger("NativeCamera");
  private proc: ChildProcessWithoutNullStreams | null = null;
  private running = false;
  private stopping = false;

  isRunning(): boolean {
    return this.running;
  }

  async listDevices(): Promise<string[]> {
    if (process.platform !== "win32") return [];
    return new Promise((resolve) => {
      const child = spawn("ffmpeg", ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"], {
        windowsHide: true
      });
      let stderr = "";
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString("utf8");
      });
      const timer = setTimeout(() => {
        child.kill();
        resolve(parseDirectShowVideoDevices(stderr));
      }, 4000);
      child.on("close", () => {
        clearTimeout(timer);
        resolve(parseDirectShowVideoDevices(stderr));
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve([]);
      });
    });
  }

  async start(opts: NativeCameraStartOptions): Promise<{ deviceName: string; size: string; fps: number }> {
    this.stop();
    if (process.platform !== "win32") {
      throw new Error("Native DirectShow camera fallback hanya tersedia di Windows.");
    }

    const devices = await this.listDevices();
    if (devices.length === 0) {
      throw new Error("Tidak ada perangkat kamera DirectShow yang terdeteksi oleh ffmpeg.");
    }

    const requestedName = opts.deviceName?.trim();
    const targetDevice =
      (requestedName &&
        requestedName !== "default" &&
        devices.find((d) => requestedName.toLowerCase().includes(d.toLowerCase()) || d.toLowerCase().includes(requestedName.toLowerCase()))) ||
      devices[0];

    const resKey: Exclude<NativeCameraResolution, "auto"> =
      opts.resolution && opts.resolution !== "auto" ? opts.resolution : "1280x720";
    const candidates = [
      ...PRESET_PROFILES[resKey],
      { size: "640x360", fps: 15 },
      { size: "640x480", fps: 15 },
      { size: "320x240", fps: 15 }
    ];

    let lastErr = "Gagal membuka kamera via ffmpeg DirectShow.";
    for (const profile of candidates) {
      const result = await this.trySpawnProfile(targetDevice, profile.size, profile.fps, opts);
      if (result.ok) {
        return { deviceName: targetDevice, size: profile.size, fps: profile.fps };
      }
      lastErr = result.error || lastErr;
      if (this.stopping) break;
    }

    throw new Error(lastErr);
  }

  private trySpawnProfile(
    deviceName: string,
    size: string,
    fps: number,
    opts: NativeCameraStartOptions
  ): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      this.stopping = false;
      let settled = false;
      let gotFrame = false;
      let stderrTail = "";
      const parser = new JpegStreamParser();

      const args = [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-f",
        "dshow",
        "-rtbufsize",
        "64M",
        "-video_size",
        size,
        "-framerate",
        String(fps),
        "-i",
        `video=${deviceName}`,
        "-vf",
        "fps=5,scale=640:-1",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-q:v",
        "6",
        "pipe:1"
      ];

      this.logger.info(`Starting ffmpeg DirectShow camera: "${deviceName}" @ ${size} ${fps}fps`);
      const child = spawn("ffmpeg", args, { windowsHide: true });
      this.proc = child;

      const startupTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.stop();
          resolve({
            ok: false,
            error: stderrTail.trim() || `Timeout membuka kamera ${deviceName} (${size}@${fps}fps)`
          });
        }
      }, 4500);

      child.stdout.on("data", (chunk: Buffer) => {
        parser.push(chunk, (jpeg) => {
          if (!gotFrame) {
            gotFrame = true;
            this.running = true;
            if (!settled) {
              settled = true;
              clearTimeout(startupTimeout);
              resolve({ ok: true });
            }
          }
          opts.onFrame(jpeg.toString("base64"));
        });
      });

      child.stderr.on("data", (d: Buffer) => {
        stderrTail = (stderrTail + d.toString("utf8")).slice(-800);
      });

      child.on("error", (err) => {
        clearTimeout(startupTimeout);
        this.running = false;
        this.proc = null;
        if (!settled) {
          settled = true;
          resolve({ ok: false, error: err.message });
        } else if (!this.stopping) {
          opts.onError?.(`Native camera error: ${err.message}`);
        }
      });

      child.on("close", (code) => {
        clearTimeout(startupTimeout);
        const wasRunning = this.running;
        this.running = false;
        if (this.proc === child) {
          this.proc = null;
        }
        if (!settled) {
          settled = true;
          resolve({
            ok: false,
            error: stderrTail.trim() || `ffmpeg exited (${code ?? "null"})`
          });
        } else if (wasRunning && !this.stopping) {
          opts.onError?.(`Webcam DirectShow terputus (exit ${code ?? "null"}).`);
        }
      });
    });
  }

  stop(): void {
    this.stopping = true;
    this.running = false;
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {
        // ignore
      }
      this.proc = null;
    }
  }
}

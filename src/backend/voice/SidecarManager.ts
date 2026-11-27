import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { Logger } from "../core/logging/Logger.js";
import type { VoiceConfig, VoiceSidecarStatus } from "../../shared/types/index.js";

export class VoiceSidecarManager {
  private readonly logger = new Logger("VoiceSidecarManager");
  private process: ChildProcess | null = null;
  private stopping = false;

  constructor(private readonly projectRoot: string) {}

  private resolvePythonPath(): string {
    const venvPython = path.join(
      this.projectRoot,
      "voice-engine",
      ".venv",
      "Scripts",
      "python.exe"
    );
    if (fs.existsSync(venvPython)) {
      return venvPython;
    }
    return "python";
  }

  async start(config: VoiceConfig): Promise<void> {
    if (this.process) return;
    this.stopping = false;

    const alreadyHealthy = await this.checkHealth(config);
    if (alreadyHealthy.connected) {
      this.logger.info("Voice sidecar already running externally");
      return;
    }

    const pythonPath = this.resolvePythonPath();
    const serverScript = path.join(this.projectRoot, "voice-engine", "server.py");

    if (!fs.existsSync(serverScript)) {
      throw new Error(`Voice engine server script not found at ${serverScript}`);
    }

    this.logger.info(`Starting local voice sidecar: ${pythonPath} ${serverScript}`);
    this.process = spawn(pythonPath, [serverScript], {
      cwd: path.join(this.projectRoot, "voice-engine"),
      env: {
        ...process.env,
        NIKA_VOICE_HOST: config.host,
        NIKA_VOICE_PORT: String(config.port),
        NIKA_STT_MODEL: config.sttModel,
        NIKA_STT_LANGUAGE: config.sttLanguage,
        NIKA_VAD_THRESHOLD: String(config.vadThreshold),
        NIKA_VAD_MIN_SILENCE_MS: String(config.vadMinSilenceMs)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.logger.info(`[voice-sidecar] ${data.toString().trim()}`);
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      this.logger.warn(`[voice-sidecar] ${data.toString().trim()}`);
    });

    this.process.on("exit", (code) => {
      this.logger.warn(`Voice sidecar exited with code ${code}`);
      this.process = null;
      if (!this.stopping) {
        setTimeout(() => {
          void this.start(config).catch((err) =>
            this.logger.error("Failed to restart voice sidecar", err)
          );
        }, 3000);
      }
    });
  }

  async checkHealth(config: VoiceConfig): Promise<VoiceSidecarStatus> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`http://${config.host}:${config.port}/health`, {
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return {
          connected: false,
          vadReady: false,
          sttReady: false,
          ttsReady: false,
          activeTtsEngines: [],
          error: `HTTP ${res.status}`
        };
      }

      const data = (await res.json()) as Omit<VoiceSidecarStatus, "connected">;
      return {
        connected: true,
        vadReady: Boolean(data.vadReady),
        sttReady: Boolean(data.sttReady),
        ttsReady: Boolean(data.ttsReady),
        activeTtsEngines: data.activeTtsEngines ?? []
      };
    } catch (err) {
      return {
        connected: false,
        vadReady: false,
        sttReady: false,
        ttsReady: false,
        activeTtsEngines: [],
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  async synthesize(params: {
    text: string;
    config: VoiceConfig;
    language?: string;
    signal?: AbortSignal;
  }): Promise<{ audio: Buffer; engine: string }> {
    const url = `http://${params.config.host}:${params.config.port}/tts/synthesize`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: params.signal,
      body: JSON.stringify({
        text: params.text,
        engine: params.config.ttsEngine,
        voice_id: params.config.ttsVoiceId,
        voice_en: params.config.ttsVoiceEn,
        speed: params.config.ttsSpeed,
        language: params.language
      })
    });

    if (!res.ok) {
      throw new Error(`TTS synthesis failed (${res.status}): ${await res.text()}`);
    }

    const arrayBuf = await res.arrayBuffer();
    const engine = res.headers.get("X-Nika-TTS-Engine") || params.config.ttsEngine;
    return {
      audio: Buffer.from(arrayBuf),
      engine
    };
  }

  async updateSidecarConfig(config: VoiceConfig): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      await fetch(`http://${config.host}:${config.port}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          vad_threshold: config.vadThreshold,
          vad_min_silence_ms: config.vadMinSilenceMs,
          stt_language: config.sttLanguage,
          stt_model: config.sttModel
        })
      });
      clearTimeout(timeout);
    } catch {
      // Sidecar may still be booting
    }
  }

  stop(): void {
    this.stopping = true;
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

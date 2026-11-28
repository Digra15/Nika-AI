import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import type { AppSettings } from "../../../shared/types/index.js";
import { getDefaultPersonaConfig } from "../../../shared/personaPresets.js";

const DEFAULT_SYSTEM_PROMPT = `You are NIKA, an autonomous, expressive, friendly 3D AI VTuber companion.
You speak naturally in Indonesian or English, matching the user's language.
Keep your spoken replies concise, warm, and conversational (1-3 sentences unless asked for detail).
Do NOT use markdown formatting (no **, *, #, bullet lists), emojis, or stage directions in your reply.
Start each reply with a single emotion tag from: [neutral], [happy], [sad], [angry], [surprised], [thinking], [laugh].
Example: "[happy] Halo! Senang banget bisa ngobrol sama kamu hari ini!"`;

export class ConfigManager {
  private settings: AppSettings;
  private readonly configFilePath: string;

  constructor(userDataDir?: string) {
    dotenv.config();
    const baseDir = userDataDir || path.join(process.cwd(), ".nika-data");
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    this.configFilePath = path.join(baseDir, "settings.json");
    this.settings = this.loadSettings();
  }

  private getDefaults(): AppSettings {
    return {
      ai: {
        baseUrl: process.env.NIKA_AI_BASE_URL || "http://127.0.0.1:20128/v1",
        apiKey: process.env.NIKA_AI_API_KEY || "9router-local-key",
        model: process.env.NIKA_AI_MODEL || "auto",
        temperature: Number(process.env.NIKA_AI_TEMPERATURE ?? 0.7),
        maxTokens: Number(process.env.NIKA_AI_MAX_TOKENS ?? 1024),
        reasoningEffort:
          (process.env.NIKA_AI_REASONING_EFFORT as AppSettings["ai"]["reasoningEffort"]) ||
          "medium",
        systemPrompt: DEFAULT_SYSTEM_PROMPT
      },
      persona: getDefaultPersonaConfig(),
      voice: {
        host: process.env.NIKA_VOICE_HOST || "127.0.0.1",
        port: Number(process.env.NIKA_VOICE_PORT ?? 20135),
        sttEngine: "faster-whisper",
        sttModel: process.env.NIKA_STT_MODEL || "small",
        sttLanguage:
          (process.env.NIKA_STT_LANGUAGE as AppSettings["voice"]["sttLanguage"]) || "auto",
        ttsEngine:
          (process.env.NIKA_TTS_ENGINE as AppSettings["voice"]["ttsEngine"]) || "auto",
        ttsVoiceId: process.env.NIKA_TTS_VOICE_ID || "id_ID-news_tts-medium",
        ttsVoiceEn: process.env.NIKA_TTS_VOICE_EN || "af_heart",
        ttsSpeed: Number(process.env.NIKA_TTS_SPEED ?? 1.0),
        sentencePauseMs: Number(process.env.NIKA_TTS_SENTENCE_PAUSE_MS ?? 480),
        breathAudioEnabled: process.env.NIKA_BREATH_AUDIO !== "false",
        breathVolume: Number(process.env.NIKA_BREATH_VOLUME ?? 0.1),
        bargeInEnabled: process.env.NIKA_BARGE_IN !== "false",
        ownerOnlyMode: process.env.NIKA_OWNER_ONLY === "true",
        vadThreshold: Number(process.env.NIKA_VAD_THRESHOLD ?? 0.45),
        vadMinSilenceMs: Number(process.env.NIKA_VAD_MIN_SILENCE_MS ?? 420),
        listeningMode: "auto",
        wakeWord: process.env.NIKA_VAD_WAKE_WORD || "nika",
        inputDeviceId: "default",
        outputDeviceId: "default"
      },
      ui: {
        alwaysOnTop: process.env.NIKA_ALWAYS_ON_TOP === "true",
        avatarPath: "",
        language: (process.env.NIKA_LANGUAGE as "id" | "en") || "id"
      }
    };
  }

  private loadSettings(): AppSettings {
    const defaults = this.getDefaults();
    if (!fs.existsSync(this.configFilePath)) {
      return defaults;
    }
    try {
      const raw = fs.readFileSync(this.configFilePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return {
        ai: { ...defaults.ai, ...(parsed.ai ?? {}) },
        persona: { ...defaults.persona, ...(parsed.persona ?? {}) },
        voice: { ...defaults.voice, ...(parsed.voice ?? {}) },
        ui: { ...defaults.ui, ...(parsed.ui ?? {}) }
      };
    } catch {
      return defaults;
    }
  }

  getSettings(): AppSettings {
    return structuredClone(this.settings);
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.settings = {
      ai: { ...this.settings.ai, ...(patch.ai ?? {}) },
      persona: { ...this.settings.persona, ...(patch.persona ?? {}) },
      voice: { ...this.settings.voice, ...(patch.voice ?? {}) },
      ui: { ...this.settings.ui, ...(patch.ui ?? {}) }
    };
    fs.writeFileSync(
      this.configFilePath,
      JSON.stringify(this.settings, null, 2),
      "utf-8"
    );
    return this.getSettings();
  }
}

import { app, BrowserWindow, desktopCapturer, dialog, ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DesktopControlService } from "../backend/agent-skills/DesktopControlService.js";
import { GameCompanionService } from "../backend/agent-skills/GameCompanionService.js";
import { KnowledgeAssistantService } from "../backend/agent-skills/KnowledgeAssistantService.js";
import { registerDesktopTools } from "../backend/agent-skills/registerDesktopTools.js";
import { registerGameTools } from "../backend/agent-skills/registerGameTools.js";
import { registerKnowledgeTools } from "../backend/agent-skills/registerKnowledgeTools.js";
import { NikaBrain } from "../backend/ai/brain/NikaBrain.js";
import { registerBrainTools } from "../backend/ai/brain/registerBrainTools.js";
import { OpenAICompatibleProvider } from "../backend/ai/providers/OpenAICompatibleProvider.js";
import { NineRouterClient } from "../backend/ai/router/NineRouterClient.js";
import { ToolRegistry } from "../backend/ai/tool-calling/ToolRegistry.js";
import { registerAgentTools } from "../backend/ai/tool-calling/registerAgentTools.js";
import { AgentBrowserService } from "../backend/browser/AgentBrowserService.js";
import { ConfigManager } from "../backend/core/config/ConfigManager.js";
import { Logger } from "../backend/core/logging/Logger.js";
import { MemoryManager } from "../backend/memory/MemoryManager.js";
import { VoiceSidecarManager } from "../backend/voice/SidecarManager.js";
import { TranscriptCorrector } from "../backend/voice/TranscriptCorrector.js";
import { NativeCameraService, type NativeCameraResolution } from "../backend/vision/NativeCameraService.js";
import type { AIConfig, AppSettings, MemoryCategory } from "../shared/types/index.js";
import { TrayManager } from "./electron/TrayManager.js";
import { MediaPermissionManager } from "./permissions/MediaPermissionManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

const logger = new Logger("Main");
if (process.platform === "win32") {
  // Prevent Windows MediaFoundation / ZeroCopy / out-of-process VideoCaptureService crashes on Electron/Chromium
  app.commandLine.appendSwitch(
    "disable-features",
    "MediaFoundationD3D11VideoCapture,MediaFoundationVideoCapture,ZeroCopyVideoCapture"
  );
  app.commandLine.appendSwitch("enable-features", "RunVideoCaptureServiceInBrowserProcess");
}
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

let latestCameraFrame: { base64: string; updatedAt: number } | null = null;
let liveVisionState = { camera: false, screen: false };
let liveScreenTimer: NodeJS.Timeout | null = null;

async function analyzeImageWithVision(
  base64: string,
  mimeType: "image/png" | "image/jpeg",
  prompt: string,
  aiConfig?: AIConfig
): Promise<string | undefined> {
  if (!aiConfig) return undefined;
  let model = aiConfig.model;
  if (!model || model === "auto") {
    model = await aiClient.resolveEffectiveModel(aiConfig).catch(() => "");
  }
  if (!model || model === "auto") return undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${aiConfig.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aiConfig.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 280,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64}` }
              }
            ]
          }
        ]
      })
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.[0]?.message?.content?.trim();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function capturePrimaryScreenBase64(): Promise<{
  base64: string;
  size: { width: number; height: number };
} | null> {
  const sources = await desktopCapturer
    .getSources({ types: ["screen"], thumbnailSize: { width: 1280, height: 720 } })
    .catch(() => []);
  const primary = sources[0];
  if (!primary) return null;
  const pngBuf = primary.thumbnail.toPNG();
  const base64 = pngBuf.toString("base64");
  return { base64, size: primary.thumbnail.getSize() };
}

const configManager = new ConfigManager(app.getPath("userData"));
const memoryManager = new MemoryManager(app.getPath("userData"));
const agentBrowser = new AgentBrowserService(PROJECT_ROOT);
const desktopControl = new DesktopControlService(PROJECT_ROOT);
const gameCompanion = new GameCompanionService();
const knowledgeAssistant = new KnowledgeAssistantService(app.getPath("userData"));
const sharedProvider = new OpenAICompatibleProvider();
const toolRegistry = new ToolRegistry();
const nikaBrain = new NikaBrain(sharedProvider, toolRegistry);
const transcriptCorrector = new TranscriptCorrector(sharedProvider);
registerAgentTools({
  registry: toolRegistry,
  memoryManager,
  browserService: agentBrowser,
  onMindUpdated: (mind) => {
    mainWindow?.webContents.send("nika:chat-stream", {
      requestId: "",
      type: "mind",
      mind
    });
  },
  onGesture: (gesture) => {
    mainWindow?.webContents.send("nika:chat-stream", {
      requestId: "",
      type: "gesture",
      gesture
    });
  }
});
registerBrainTools({
  registry: toolRegistry,
  brain: nikaBrain,
  getAIConfig: () => configManager.getSettings().ai,
  onPlanUpdated: (plan) => {
    mainWindow?.webContents.send("nika:chat-stream", {
      requestId: "",
      type: "plan",
      plan: plan
        ? {
            goal: plan.goal,
            doneCount: plan.steps.filter((s) => s.status === "done").length,
            totalCount: plan.steps.length
          }
        : null
    });
  }
});
registerDesktopTools({
  registry: toolRegistry,
  desktop: desktopControl,
  browserService: agentBrowser,
  getAIConfig: () => configManager.getSettings().ai,
  captureScreenSummary: async (question, aiConfig) => {
    const winInfo = await desktopControl.computerAction({ action: "active_window" });
    const captured = await capturePrimaryScreenBase64();
    if (!captured) {
      return { ...winInfo, screenshotSaved: false };
    }
    const outPath = path.join(app.getPath("userData"), "last-screen.png");
    fs.writeFileSync(outPath, Buffer.from(captured.base64, "base64"));

    const visualAnalysis = await analyzeImageWithVision(
      captured.base64,
      "image/png",
      question || "Ringkas apa yang sedang terlihat di layar desktop ini secara singkat dan jelas.",
      aiConfig
    );

    return {
      ...winInfo,
      screenshotSaved: true,
      screenshotPath: outPath,
      screenSize: captured.size,
      ...(visualAnalysis ? { visualAnalysis } : {})
    };
  },
  captureCameraSummary: async (question, aiConfig) => {
    if (!liveVisionState.camera || !latestCameraFrame) {
      return {
        cameraActive: false,
        error: "Kamera belum diaktifkan. Minta pengguna menyalakan tombol Camera di dock bawah."
      };
    }
    const visualAnalysis = await analyzeImageWithVision(
      latestCameraFrame.base64,
      "image/jpeg",
      question || "Jelaskan apa yang terlihat di depan kamera (ekspresi orang, benda, atau suasana) secara singkat.",
      aiConfig
    );
    return {
      cameraActive: true,
      frameAgeMs: Date.now() - latestCameraFrame.updatedAt,
      ...(visualAnalysis
        ? { visualAnalysis }
        : { note: "Frame kamera tersedia tetapi model AI aktif tidak merespons analisis gambar." })
    };
  }
});
registerGameTools({
  registry: toolRegistry,
  gameService: gameCompanion,
  memoryManager,
  getAIConfig: () => configManager.getSettings().ai,
  captureScreenSummary: async (question, aiConfig) => {
    const winInfo = await desktopControl.computerAction({ action: "active_window" });
    const captured = await capturePrimaryScreenBase64();
    if (!captured) return { ...winInfo, screenshotSaved: false };
    const visualAnalysis = await analyzeImageWithVision(
      captured.base64,
      "image/png",
      question || "Analisis tampilan game di layar ini.",
      aiConfig
    );
    return {
      ...winInfo,
      screenshotSaved: true,
      screenSize: captured.size,
      ...(visualAnalysis ? { visualAnalysis } : {})
    };
  },
  onReaction: (reaction) => {
    mainWindow?.webContents.send("nika:chat-stream", {
      requestId: "",
      type: "gesture",
      gesture: reaction.gesture
    });
  }
});
registerKnowledgeTools({
  registry: toolRegistry,
  knowledgeService: knowledgeAssistant,
  browserService: agentBrowser,
  desktopControl
});
const aiClient = new NineRouterClient();
aiClient.setHistory(memoryManager.getRecentHistory());
const voiceSidecar = new VoiceSidecarManager(PROJECT_ROOT);
const trayManager = new TrayManager();
const mediaPermissions = new MediaPermissionManager();
const nativeCamera = new NativeCameraService();

function resolvePreloadPath(): string {
  const srcPreload = path.join(PROJECT_ROOT, "src", "main", "preload.cjs");
  if (fs.existsSync(srcPreload)) {
    return srcPreload;
  }
  return path.join(__dirname, "preload.cjs");
}

function createWindow(): void {
  const settings = configManager.getSettings();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0b0714",
    alwaysOnTop: settings.ui.alwaysOnTop,
    title: "NIKA — Autonomous AI VTuber",
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL || !app.isPackaged) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(PROJECT_ROOT, "dist", "index.html"));
  }

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logger.error(`Renderer process gone: ${details.reason} (exitCode=${details.exitCode})`);
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle("nika:get-settings", () => configManager.getSettings());

  ipcMain.handle("nika:update-settings", async (_event, patch: Partial<AppSettings>) => {
    const updated = configManager.updateSettings(patch);
    if (mainWindow) {
      mainWindow.setAlwaysOnTop(updated.ui.alwaysOnTop);
    }
    await voiceSidecar.updateSidecarConfig(updated.voice);
    return updated;
  });

  ipcMain.handle("nika:router-health", async () => {
    const { ai } = configManager.getSettings();
    return aiClient.checkHealth(ai);
  });

  ipcMain.handle("nika:list-models", async () => {
    const { ai } = configManager.getSettings();
    return aiClient.getModels(ai);
  });

  ipcMain.handle("nika:voice-health", async () => {
    const { voice } = configManager.getSettings();
    return voiceSidecar.checkHealth(voice);
  });

  ipcMain.handle("nika:system-readiness", async () => {
    const { ai, voice } = configManager.getSettings();
    const [routerOnline, voiceHealth] = await Promise.all([
      aiClient.checkHealth(ai).catch(() => false),
      voiceSidecar.checkHealth(voice).catch(() => ({
        connected: false,
        vadReady: false,
        sttReady: false,
        ttsReady: false,
        activeTtsEngines: []
      }))
    ]);
    return {
      configReady: true,
      memoryReady: true,
      toolsCount: toolRegistry.getDefinitions().length,
      agentBrowserReady: agentBrowser.isReady(),
      routerOnline,
      voice: voiceHealth
    };
  });

  ipcMain.handle(
    "nika:chat-send",
    async (
      _event,
      payload: {
        text: string;
        requestId: string;
        isVoiceInput?: boolean;
        confidence?: number;
        voiceEmotion?: string;
        speakerLabel?: string;
      }
    ) => {
      const settings = configManager.getSettings();
      let effectiveModel = settings.ai.model;
      if (payload.isVoiceInput && effectiveModel === "auto") {
        effectiveModel = await aiClient.resolveEffectiveModel(settings.ai).catch(() => "auto");
      }
      const correction = await transcriptCorrector.correct({
        text: payload.text,
        confidence: payload.confidence,
        isVoiceInput: payload.isVoiceInput,
        config: { ...settings.ai, model: effectiveModel },
        recentHistory: memoryManager.getRecentHistory(),
        memories: memoryManager.getSnapshot().memories
      });
      const finalUserText = correction.correctedText;
      if (correction.wasModified) {
        mainWindow?.webContents.send("nika:chat-stream", {
          requestId: payload.requestId,
          type: "transcript_corrected",
          rawText: correction.rawText,
          correctedText: finalUserText
        });
      }

      memoryManager.extractAndStoreFromUserMessage(finalUserText);
      const mindAfterUser = memoryManager.updateMindFromUserMessage(
        finalUserText,
        payload.voiceEmotion
      );
      mainWindow?.webContents.send("nika:chat-stream", {
        requestId: payload.requestId,
        type: "mind",
        mind: mindAfterUser
      });

      const memSnap = memoryManager.getSnapshot();
      const contextAnalysis = nikaBrain.analyzeContext({
        userText: finalUserText,
        recentHistory: memoryManager.getRecentHistory(),
        memories: memSnap.memories,
        mind: mindAfterUser
      });

      let systemPromptOverride = memoryManager.buildSystemPrompt({
        baseSystemPrompt: settings.ai.systemPrompt,
        persona: settings.persona,
        userText: finalUserText,
        contextAnalysis,
        voiceEmotion: payload.voiceEmotion,
        speakerLabel: payload.speakerLabel
      });

      if (liveVisionState.camera || liveVisionState.screen) {
        systemPromptOverride += `\n\n[LIVE VISION STATUS]\nLive Camera: ${liveVisionState.camera ? "ON (panggil camera_see jika ditanya atau ingin melihat pengguna/sekitar)" : "OFF"} | Live Screen: ${liveVisionState.screen ? "ON (panggil screen_understand untuk melihat layar desktop saat ini)" : "OFF"}`;
      }

      try {
        const assistantMsg = await aiClient.sendMessage({
          userText: finalUserText,
          config: settings.ai,
          systemPromptOverride,
          toolRegistry,
          onToken: (delta) => {
            mainWindow?.webContents.send("nika:chat-stream", {
              requestId: payload.requestId,
              type: "token",
              delta
            });
          },
          onEmotion: (emotion) => {
            mainWindow?.webContents.send("nika:chat-stream", {
              requestId: payload.requestId,
              type: "emotion",
              emotion
            });
          },
          onSentence: (sentence) => {
            mainWindow?.webContents.send("nika:chat-stream", {
              requestId: payload.requestId,
              type: "sentence",
              sentence
            });
          },
          onToolCall: (tool) => {
            mainWindow?.webContents.send("nika:chat-stream", {
              requestId: payload.requestId,
              type: "tool",
              tool
            });
          }
        });

        memoryManager.appendHistory({
          id: `user-${Date.now()}`,
          role: "user",
          content: finalUserText,
          timestamp: Date.now()
        });
        memoryManager.appendHistory(assistantMsg);
        const mindAfterReply = memoryManager.updateMindFromAssistantEmotion(
          assistantMsg.emotion ?? "neutral"
        );

        mainWindow?.webContents.send("nika:chat-stream", {
          requestId: payload.requestId,
          type: "mind",
          mind: mindAfterReply
        });

        mainWindow?.webContents.send("nika:chat-stream", {
          requestId: payload.requestId,
          type: "done",
          message: assistantMsg
        });

        return assistantMsg;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return null;
        }
        throw err;
      }
    }
  );

  ipcMain.handle("nika:chat-abort", () => {
    aiClient.abortActiveRequest();
    return true;
  });

  ipcMain.handle("nika:chat-clear", () => {
    aiClient.clearHistory();
    memoryManager.clearHistory();
    return true;
  });

  ipcMain.handle("nika:get-memory-snapshot", () => memoryManager.getSnapshot());

  ipcMain.handle(
    "nika:add-memory",
    (
      _event,
      payload: { content: string; category?: MemoryCategory; importance?: number }
    ) => memoryManager.addMemory(payload.content, payload.category, payload.importance)
  );

  ipcMain.handle("nika:delete-memory", (_event, id: string) =>
    memoryManager.deleteMemory(id)
  );

  ipcMain.handle("nika:clear-memories", () => {
    memoryManager.clearMemories();
    return true;
  });

  ipcMain.handle("nika:reset-mind", () => memoryManager.resetMind());

  ipcMain.handle(
    "nika:tts-synthesize",
    async (_event, payload: { text: string; language?: string }) => {
      const { voice } = configManager.getSettings();
      const result = await voiceSidecar.synthesize({
        text: payload.text,
        config: voice,
        language: payload.language
      });
      return {
        audioBase64: result.audio.toString("base64"),
        engine: result.engine
      };
    }
  );

  ipcMain.handle("nika:pick-avatar", async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "Select VRM or GLB Avatar",
      filters: [{ name: "3D Avatar", extensions: ["vrm", "glb"] }],
      properties: ["openFile"]
    });
    if (res.canceled || res.filePaths.length === 0) return null;

    const filePath = res.filePaths[0];
    const data = fs.readFileSync(filePath);
    configManager.updateSettings({
      ui: { ...configManager.getSettings().ui, avatarPath: filePath }
    });
    return {
      filePath,
      fileName: path.basename(filePath),
      base64: data.toString("base64")
    };
  });

  ipcMain.handle("nika:vision-update-camera", (_event, base64: string | null) => {
    if (!base64) {
      latestCameraFrame = null;
    } else {
      latestCameraFrame = { base64, updatedAt: Date.now() };
    }
    return true;
  });

  ipcMain.handle(
    "nika:vision-start-native-camera",
    async (
      _event,
      opts: { deviceName?: string; resolution?: NativeCameraResolution }
    ) => {
      const info = await nativeCamera.start({
        deviceName: opts?.deviceName,
        resolution: opts?.resolution ?? "1280x720",
        onFrame: (base64) => {
          latestCameraFrame = { base64, updatedAt: Date.now() };
          liveVisionState.camera = true;
          mainWindow?.webContents.send("nika:vision-camera-frame", base64);
        },
        onError: (reason) => {
          liveVisionState.camera = false;
          latestCameraFrame = null;
          mainWindow?.webContents.send("nika:vision-camera-error", reason);
        }
      });
      liveVisionState.camera = true;
      return info;
    }
  );

  ipcMain.handle("nika:vision-stop-native-camera", () => {
    nativeCamera.stop();
    liveVisionState.camera = false;
    latestCameraFrame = null;
    return true;
  });

  ipcMain.handle("nika:vision-list-native-cameras", () => nativeCamera.listDevices());

  ipcMain.handle(
    "nika:vision-set-live",
    async (_event, state: { camera?: boolean; screen?: boolean }) => {
      if (state.camera !== undefined) {
        liveVisionState.camera = state.camera;
        if (!state.camera) latestCameraFrame = null;
      }
      if (state.screen !== undefined) {
        liveVisionState.screen = state.screen;
        if (liveScreenTimer) {
          clearInterval(liveScreenTimer);
          liveScreenTimer = null;
        }
        if (state.screen) {
          await capturePrimaryScreenBase64();
          liveScreenTimer = setInterval(() => {
            void capturePrimaryScreenBase64();
          }, 4000);
        }
      }
      return true;
    }
  );

  ipcMain.handle("nika:toggle-always-on-top", () => {
    const current = configManager.getSettings();
    const next = !current.ui.alwaysOnTop;
    configManager.updateSettings({
      ui: { ...current.ui, alwaysOnTop: next }
    });
    mainWindow?.setAlwaysOnTop(next);
    return next;
  });
}

app.on("child-process-gone", (_event, details) => {
  logger.error(
    `Child process gone: type=${details.type}, reason=${details.reason}, name=${details.name ?? details.serviceName ?? "unknown"}, exitCode=${details.exitCode}`
  );
});

app.whenReady().then(async () => {
  await mediaPermissions.initialize();
  registerIpcHandlers();
  createWindow();

  trayManager.create(
    () => mainWindow,
    () => {
      const current = configManager.getSettings();
      const next = !current.ui.alwaysOnTop;
      configManager.updateSettings({ ui: { ...current.ui, alwaysOnTop: next } });
      mainWindow?.setAlwaysOnTop(next);
    }
  );

  const { voice } = configManager.getSettings();
  void voiceSidecar.start(voice).catch((err) => {
    logger.error("Failed to start voice sidecar", err);
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  nativeCamera.stop();
  void agentBrowser.close();
  voiceSidecar.stop();
  trayManager.destroy();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

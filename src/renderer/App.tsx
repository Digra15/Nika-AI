import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  Pin,
  Send,
  Settings,
  Square,
  Trash2,
  Upload,
  Volume2
} from "lucide-react";
import type {
  AIModelInfo,
  AppSettings,
  AvatarActivityState,
  ChatMessage,
  EmotionType,
  ListeningMode,
  NikaMindState,
  VoiceSidecarStatus
} from "../shared/types/index";
import { AudioPipeline } from "./audio/AudioPipeline";
import type { AvatarGestureType } from "./avatar/AvatarController";
import { AvatarScene } from "./avatar/AvatarScene";
import { NikaBootScreen } from "./components/NikaBootScreen";
import { SettingsModal } from "./components/SettingsModal";
import { getDefaultPersonaConfig } from "../shared/personaPresets";
import type { SystemReadiness } from "../shared/types/index";

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [models, setModels] = useState<AIModelInfo[]>([]);
  const [routerOnline, setRouterOnline] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceSidecarStatus>({
    connected: false,
    vadReady: false,
    sttReady: false,
    ttsReady: false,
    activeTtsEngines: []
  });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [inputText, setInputText] = useState("");

  const [vadActive, setVadActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [lastSpeaker, setLastSpeaker] = useState<string | null>(null);
  const [lastVoiceEmotion, setLastVoiceEmotion] = useState<string | null>(null);
  const [gestureSignal, setGestureSignal] = useState<{
    type: AvatarGestureType;
    seq: number;
  } | null>(null);
  const [activePlan, setActivePlan] = useState<{
    goal: string;
    doneCount: number;
    totalCount: number;
  } | null>(null);
  const [emotion, setEmotion] = useState<EmotionType>("neutral");
  const [mind, setMind] = useState<NikaMindState>({
    mood: "cheerful",
    happiness: 70,
    affection: 55,
    energy: 75,
    trust: 60,
    interactionCount: 0,
    lastInteractionAt: Date.now()
  });
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [pttActive, setPttActive] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [booting, setBooting] = useState(() => Boolean(typeof window !== "undefined" && window.nikaAPI));
  const [readiness, setReadiness] = useState<SystemReadiness | null>(null);
  const [allowBootSkip, setAllowBootSkip] = useState(false);

  const activeRequestIdRef = useRef<string | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const ttsQueueRef = useRef<Promise<void>>(Promise.resolve());
  const settingsRef = useRef<AppSettings | null>(null);
  settingsRef.current = settings;
  const chatEndRef = useRef<HTMLDivElement>(null);
  const modelsCountRef = useRef(0);
  modelsCountRef.current = models.length;

  const enqueueSentenceTTS = useCallback((sentence: string, language?: string) => {
    const clean = sentence.trim();
    if (!clean || !/[\p{L}\p{N}]/u.test(clean)) return;

    ttsQueueRef.current = ttsQueueRef.current
      .then(async () => {
        if (!activeRequestIdRef.current) return;
        const voiceCfg = settingsRef.current?.voice;
        const langHint =
          language ?? (settingsRef.current?.ui.language === "id" ? "id" : undefined);
        if (voiceCfg && audioPipelineRef.current) {
          if (!ttsAbortRef.current || ttsAbortRef.current.signal.aborted) {
            ttsAbortRef.current = new AbortController();
          }
          await audioPipelineRef.current.streamSpeech({
            text: clean,
            config: voiceCfg,
            language: langHint,
            signal: ttsAbortRef.current.signal
          });
          return;
        }
        const { audioBase64 } = await window.nikaAPI.synthesizeSpeech({
          text: clean,
          language: langHint
        });
        await audioPipelineRef.current?.enqueueWavBase64(audioBase64);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("TTS stream error:", err);
      });
  }, []);

  const sendPromptToNika = useCallback(
    async (
      text: string,
      opts?: {
        isVoiceInput?: boolean;
        confidence?: number;
        voiceEmotion?: string;
        speakerLabel?: string;
      }
    ) => {
      const clean = text.trim();
      if (!clean) return;

      const requestId = `req-${Date.now()}`;
      activeRequestIdRef.current = requestId;
      ttsAbortRef.current?.abort();
      ttsAbortRef.current = new AbortController();
      setIsGenerating(true);
      setEmotion("neutral");
      setStreamingText("");
      setMessages((prev) => [
        ...prev,
        { id: requestId, role: "user", content: clean, timestamp: Date.now() }
      ]);

      try {
        await window.nikaAPI.sendChatMessage({
          text: clean,
          requestId,
          isVoiceInput: opts?.isVoiceInput,
          confidence: opts?.confidence,
          voiceEmotion: opts?.voiceEmotion,
          speakerLabel: opts?.speakerLabel
        });
      } catch (err) {
      console.error("Chat error:", err);
      setIsGenerating(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: `[Error] ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now()
        }
      ]);
    }
  }, []);

  const audioPipelineRef = useRef<AudioPipeline | null>(null);
  if (!audioPipelineRef.current) {
    audioPipelineRef.current = new AudioPipeline({
      onVadChange: (active) => {
        setVadActive(active);
        if (!active) {
          setPartialTranscript("");
        }
      },
      onPartialTranscript: (ev) => setPartialTranscript(ev.text),
      onFinalTranscript: (ev) => {
        setPartialTranscript("");
        if (ev.speaker?.label) setLastSpeaker(ev.speaker.label);
        if (ev.voiceEmotion?.emotion) setLastVoiceEmotion(ev.voiceEmotion.emotion);
        void sendPromptToNika(ev.text, {
          isVoiceInput: true,
          confidence: ev.confidence,
          voiceEmotion: ev.voiceEmotion?.emotion,
          speakerLabel: ev.speaker?.label
        });
      },
      onInterrupt: () => {
        activeRequestIdRef.current = null;
        ttsAbortRef.current?.abort();
        ttsAbortRef.current = null;
        void window.nikaAPI.abortChat();
        setIsGenerating(false);
        setEmotion("neutral");
      },
      onSpeakingChange: (speaking) => setIsSpeaking(speaking),
      onSocketStatus: (connected) => {
        setWsConnected(connected);
        setVoiceStatus((prev) => ({ ...prev, connected }));
      },
      onMicStatus: (active, error) => {
        setMicActive(active);
        setMicError(error ?? null);
      }
    });
  }

  const refreshRouterAndModels = useCallback(async () => {
    const ok = await window.nikaAPI.checkRouterHealth();
    setRouterOnline(ok);
    if (ok) {
      const discovered = await window.nikaAPI.listModels().catch(() => []);
      setModels(discovered);
      return { online: true, models: discovered };
    }
    return { online: false, models: [] as AIModelInfo[] };
  }, []);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      if (!window.nikaAPI) return;
      const cfg = await window.nikaAPI.getSettings();
      if (!mounted) return;
      setSettings(cfg);

      const memSnap = await window.nikaAPI.getMemorySnapshot().catch(() => null);
      if (mounted && memSnap) setMind(memSnap.mind);

      const ok = await window.nikaAPI.checkRouterHealth();
      if (mounted) setRouterOnline(ok);
      if (ok) {
        const discovered = await window.nikaAPI.listModels().catch(() => []);
        if (mounted) setModels(discovered);
      }

      const vHealth = await window.nikaAPI.checkVoiceHealth();
      if (mounted) setVoiceStatus(vHealth);

      await audioPipelineRef.current?.start(cfg.voice).catch((err) => {
        console.warn("Microphone or voice sidecar not ready yet:", err);
      });
    };
    void init();

    let pollTimer: number | null = null;
    const pollHealth = async () => {
      if (!mounted || !window.nikaAPI) return;
      const [rOk, vHealth] = await Promise.all([
        window.nikaAPI.checkRouterHealth(),
        window.nikaAPI.checkVoiceHealth()
      ]);
      if (!mounted) return;
      setRouterOnline(rOk);
      setVoiceStatus(vHealth);
      if (vHealth.vadReady && vHealth.sttReady && !audioPipelineRef.current?.isSocketOpen()) {
        const currentSettings = await window.nikaAPI.getSettings();
        void audioPipelineRef.current?.ensureActive(currentSettings.voice).catch(() => {});
      }
      if (rOk && modelsCountRef.current === 0) {
        const discovered = await window.nikaAPI.listModels().catch(() => []);
        if (mounted && discovered.length > 0) {
          setModels(discovered);
        }
      }
      if (mounted) {
        pollTimer = window.setTimeout(() => void pollHealth(), 15000);
      }
    };
    pollTimer = window.setTimeout(() => void pollHealth(), 5000);

    const unsubStream = window.nikaAPI
      ? window.nikaAPI.onChatStream((ev) => {
          if (ev.requestId !== activeRequestIdRef.current) return;
          if (ev.type === "token") {
            setStreamingText((prev) => prev + ev.delta);
          } else if (ev.type === "transcript_corrected") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === ev.requestId ? { ...m, content: ev.correctedText } : m
              )
            );
          } else if (ev.type === "emotion") {
            setEmotion(ev.emotion);
          } else if (ev.type === "mind") {
            setMind(ev.mind);
          } else if (ev.type === "gesture") {
            setGestureSignal({
              type: ev.gesture as AvatarGestureType,
              seq: Date.now()
            });
          } else if (ev.type === "plan") {
            setActivePlan(ev.plan);
          } else if (ev.type === "tool") {
            setActiveTool(ev.tool.status === "running" ? ev.tool.name : null);
          } else if (ev.type === "sentence") {
            enqueueSentenceTTS(ev.sentence);
          } else if (ev.type === "done") {
            setIsGenerating(false);
            setActiveTool(null);
            setStreamingText("");
            setMessages((prev) => [...prev, ev.message]);
          }
        })
      : () => {};

    return () => {
      mounted = false;
      if (pollTimer !== null) clearTimeout(pollTimer);
      unsubStream();
      audioPipelineRef.current?.dispose();
    };
  }, [enqueueSentenceTTS]);

  useEffect(() => {
    if (!booting || !window.nikaAPI?.checkSystemReadiness) return;
    let active = true;
    const skipTimer = window.setTimeout(() => {
      if (active) setAllowBootSkip(true);
    }, 6500);

    const check = async () => {
      if (!active || !window.nikaAPI?.checkSystemReadiness) return;
      const status = await window.nikaAPI.checkSystemReadiness().catch(() => null);
      if (!active || !status) return;
      setReadiness(status);
      const allReady =
        status.configReady &&
        status.memoryReady &&
        status.toolsCount > 0 &&
        status.voice.vadReady &&
        status.voice.sttReady &&
        status.voice.ttsReady &&
        status.routerOnline;
      if (allReady) {
        window.setTimeout(() => {
          if (active) setBooting(false);
        }, 350);
        return;
      }
      window.setTimeout(() => void check(), 900);
    };

    void check();
    return () => {
      active = false;
      clearTimeout(skipTimer);
    };
  }, [booting]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  useEffect(() => {
    if (emotion === "neutral" || isGenerating || isSpeaking) return;
    const timer = window.setTimeout(() => {
      setEmotion("neutral");
    }, 1800);
    return () => clearTimeout(timer);
  }, [emotion, isGenerating, isSpeaking]);

  const avatarState: AvatarActivityState = useMemo(() => {
    if (isSpeaking) return emotion === "laugh" ? "laughing" : "talking";
    if (isGenerating) return "thinking";
    if (vadActive) return "listening";
    return "idle";
  }, [isSpeaking, isGenerating, vadActive, emotion]);

  const handleModelSwitch = async (modelId: string) => {
    if (!settings) return;
    const updated = await window.nikaAPI.updateSettings({
      ai: { ...settings.ai, model: modelId }
    });
    setSettings(updated);
  };

  const handleModeSwitch = async (mode: ListeningMode) => {
    if (!settings) return;
    const updated = await window.nikaAPI.updateSettings({
      voice: { ...settings.voice, listeningMode: mode }
    });
    setSettings(updated);
    audioPipelineRef.current?.updateConfig(updated.voice);
    if (mode !== "muted") {
      await audioPipelineRef.current?.ensureActive(updated.voice).catch(() => {});
    }
  };

  const handleInterrupt = async () => {
    activeRequestIdRef.current = null;
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    audioPipelineRef.current?.stopPlayback();
    await window.nikaAPI.abortChat();
    setIsGenerating(false);
    setEmotion("neutral");
  };

  const handlePickAvatar = async () => {
    const picked = await window.nikaAPI.pickAvatarFile();
    if (picked) {
      setAvatarBase64(picked.base64);
    }
  };

  const handleSaveSettings = async (updated: AppSettings) => {
    const saved = await window.nikaAPI.updateSettings(updated);
    setSettings(saved);
    audioPipelineRef.current?.updateConfig(saved.voice);
    if (saved.voice.inputDeviceId !== settings?.voice.inputDeviceId) {
      await audioPipelineRef.current?.restartMicrophone(saved.voice.inputDeviceId);
    }
    await refreshRouterAndModels();
  };

  const handleTestAndLoadModels = async (aiConfig: AppSettings["ai"]) => {
    if (!settings) {
      return { online: false, models: [], error: "Settings not loaded" };
    }
    const saved = await window.nikaAPI.updateSettings({ ai: aiConfig });
    setSettings(saved);
    try {
      const ok = await window.nikaAPI.checkRouterHealth();
      setRouterOnline(ok);
      if (!ok) {
        return { online: false, models: [], error: `Cannot reach ${aiConfig.baseUrl}/models (check 9Router & API key)` };
      }
      const discovered = await window.nikaAPI.listModels();
      setModels(discovered);
      return { online: true, models: discovered };
    } catch (err) {
      return {
        online: false,
        models: [],
        error: err instanceof Error ? err.message : String(err)
      };
    }
  };

  return (
    <div className="nika-shell">
      <header className="nika-topbar">
        <div className="nika-brand">
          <span className="nika-logo-dot" />
          <span>NIKA</span>
          <span className="nika-brand-sub">Autonomous AI Companion</span>
        </div>

        <div className="nika-topbar-actions">
          <span className="nika-pill">
            <span className={`nika-status-dot ${routerOnline ? "ok" : "warn"}`} />
            9Router {routerOnline ? "Online" : "Offline"}
          </span>

          <span className="nika-pill">
            <span
              className={`nika-status-dot ${
                voiceStatus.sttReady && voiceStatus.vadReady && wsConnected ? "ok" : "pulse"
              }`}
            />
            {voiceStatus.sttReady && voiceStatus.vadReady
              ? wsConnected
                ? voiceStatus.activeTtsEngines.join("/") || "Voice Ready"
                : "Connecting..."
              : "Voice Booting..."}
          </span>

          <select
            className="nika-select"
            value={settings?.ai.model ?? "auto"}
            onChange={(e) => void handleModelSwitch(e.target.value)}
            title="Switch 9Router Model Live"
          >
            <option value="auto">Model: Auto</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>

          <button className="nika-btn" onClick={() => void handlePickAvatar()}>
            <Upload size={14} /> Load VRM/GLB
          </button>

          <button
            className={`nika-btn ${settings?.ui.alwaysOnTop ? "active" : ""}`}
            onClick={async () => {
              const next = await window.nikaAPI.toggleAlwaysOnTop();
              if (settings) {
                setSettings({ ...settings, ui: { ...settings.ui, alwaysOnTop: next } });
              }
            }}
            title="Toggle Always on Top"
          >
            <Pin size={14} />
          </button>

          <button
            className="nika-btn"
            onClick={async () => {
              if (window.nikaAPI) {
                const latest = await window.nikaAPI.getSettings();
                setSettings(latest);
              } else if (!settings) {
                setSettings({
                  ai: {
                    baseUrl: "http://127.0.0.1:20128/v1",
                    apiKey: "9router-local-key",
                    model: "auto",
                    temperature: 0.7,
                    maxTokens: 1024,
                    reasoningEffort: "medium",
                    systemPrompt: ""
                  },
                  persona: getDefaultPersonaConfig(),
                  voice: {
                    host: "127.0.0.1",
                    port: 20135,
                    sttEngine: "faster-whisper",
                    sttModel: "sherpa-zipformer-id-en",
                    sttLanguage: "id",
                    ttsEngine: "auto",
                    ttsVoiceId: "id_ID-news_tts-medium",
                    ttsVoiceEn: "af_heart",
                    ttsSpeed: 1,
                    sentencePauseMs: 480,
                    breathAudioEnabled: true,
                    breathVolume: 0.1,
                    bargeInEnabled: true,
                    vadThreshold: 0.45,
                    vadMinSilenceMs: 420,
                    listeningMode: "auto",
                    wakeWord: "nika",
                    inputDeviceId: "default",
                    outputDeviceId: "default"
                  },
                  ui: { alwaysOnTop: false, avatarPath: "", language: "id" }
                });
              }
              setShowSettings(true);
            }}
          >
            <Settings size={14} /> Settings
          </button>
        </div>
      </header>

      <main className="nika-main">
        <section className="nika-stage">
          <div className="nika-hud-top-left">
            <span className="nika-pill cyan">State: {avatarState.toUpperCase()}</span>
            <span className="nika-pill">Emotion: {emotion}</span>
            <span className="nika-pill" title={`Happiness ${mind.happiness} | Energy ${mind.energy} | Trust ${mind.trust}`}>
              Mood: {mind.mood} · ❤️ {mind.affection}%
            </span>
            {lastSpeaker && (
              <span className="nika-pill">
                {lastSpeaker}
                {lastVoiceEmotion && lastVoiceEmotion !== "neutral"
                  ? ` · ${lastVoiceEmotion}`
                  : ""}
              </span>
            )}
            {activePlan && (
              <span className="nika-pill" title={activePlan.goal}>
                Plan: {activePlan.doneCount}/{activePlan.totalCount}
              </span>
            )}
            {activeTool && (
              <span className="nika-pill cyan">Agent: {activeTool}</span>
            )}
          </div>

          {audioPipelineRef.current && (
            <AvatarScene
              avatarBase64={avatarBase64}
              avatarState={avatarState}
              emotion={emotion}
              mood={mind.mood}
              gestureSignal={gestureSignal}
              audioPipeline={audioPipelineRef.current}
            />
          )}

          {partialTranscript && (
            <div className="nika-transcript-float">🎙️ {partialTranscript}</div>
          )}

          <div className="nika-voice-dock">
            <select
              className="nika-select"
              value={settings?.voice.listeningMode ?? "auto"}
              onChange={(e) => void handleModeSwitch(e.target.value as ListeningMode)}
            >
              <option value="auto">Auto Listening (VAD)</option>
              <option value="wake-word">Wake Word ({settings?.voice.wakeWord})</option>
              <option value="push-to-talk">Push-to-Talk</option>
              <option value="muted">Mic Muted</option>
            </select>

            {settings?.voice.listeningMode === "push-to-talk" ? (
              <button
                className={`nika-btn ${pttActive ? "active" : ""}`}
                onMouseDown={() => {
                  setPttActive(true);
                  audioPipelineRef.current?.setPushToTalk(true);
                  if (settings) {
                    void audioPipelineRef.current?.ensureActive(settings.voice).catch(() => {});
                  }
                }}
                onMouseUp={() => {
                  setPttActive(false);
                  audioPipelineRef.current?.setPushToTalk(false);
                }}
                onMouseLeave={() => {
                  setPttActive(false);
                  audioPipelineRef.current?.setPushToTalk(false);
                }}
              >
                <Mic size={14} /> Hold to Talk
              </button>
            ) : (
              <button
                className={`nika-btn ${
                  settings?.voice.listeningMode === "muted" || micError ? "danger" : "active"
                }`}
                title={micError ?? undefined}
                onClick={() => {
                  if (micError && settings) {
                    void audioPipelineRef.current?.ensureActive(settings.voice).catch(() => {});
                    return;
                  }
                  void handleModeSwitch(
                    settings?.voice.listeningMode === "muted" ? "auto" : "muted"
                  );
                }}
              >
                {settings?.voice.listeningMode === "muted" ? (
                  <>
                    <MicOff size={14} /> Muted
                  </>
                ) : micError ? (
                  <>
                    <MicOff size={14} /> Mic Error (Retry)
                  </>
                ) : (
                  <>
                    <Mic size={14} /> {vadActive ? "Listening..." : micActive ? "Mic Active" : "Mic Starting..."}
                  </>
                )}
              </button>
            )}

            {(isSpeaking || isGenerating) && (
              <button className="nika-btn danger" onClick={() => void handleInterrupt()}>
                <Square size={14} /> Stop / Interrupt
              </button>
            )}
          </div>
        </section>

        <aside className="nika-sidebar">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              borderBottom: "1px solid var(--border-glow)"
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "#67e8f9" }}>
              <Volume2 size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
              Conversation
            </span>
            <button
              className="nika-btn"
              onClick={async () => {
                await window.nikaAPI.clearHistory();
                setMessages([]);
              }}
              title="Clear Chat History"
            >
              <Trash2 size={13} />
            </button>
          </div>

          <div className="nika-chat-list">
            {messages.length === 0 && !streamingText && (
              <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", marginTop: 24 }}>
                Speak to NIKA in Indonesian or English, or type below.
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`nika-msg ${m.role}`}>
                {m.content}
              </div>
            ))}
            {streamingText && <div className="nika-msg assistant">{streamingText}</div>}
            <div ref={chatEndRef} />
          </div>

          <form
            className="nika-input-bar"
            onSubmit={(e) => {
              e.preventDefault();
              if (!inputText.trim()) return;
              const text = inputText;
              setInputText("");
              void sendPromptToNika(text);
            }}
          >
            <input
              className="nika-input"
              placeholder="Type a message to NIKA..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
            <button className="nika-btn active" type="submit">
              <Send size={14} />
            </button>
          </form>
        </aside>
      </main>

      {showSettings && settings && (
        <SettingsModal
          settings={settings}
          models={models}
          onClose={() => setShowSettings(false)}
          onLiveUpdate={handleSaveSettings}
          onTestAndLoadModels={handleTestAndLoadModels}
          onMindChange={setMind}
        />
      )}

      {booting && (
        <NikaBootScreen
          readiness={readiness}
          allowSkip={allowBootSkip}
          onContinue={() => setBooting(false)}
        />
      )}
    </div>
  );
}

import React, { useEffect, useRef, useState } from "react";
import {
  Brain,
  Check,
  Cpu,
  Mic,
  Sliders,
  Sparkles,
  X
} from "lucide-react";
import { PERSONA_PRESETS } from "../../shared/personaPresets";
import type {
  AIModelInfo,
  AppSettings,
  MemoryItem,
  NikaMindState,
  PersonaPresetId
} from "../../shared/types/index";

type SettingsTab = "ai" | "persona" | "voice" | "memory" | "system";

interface SettingsModalProps {
  settings: AppSettings;
  models: AIModelInfo[];
  onClose: () => void;
  onLiveUpdate: (updated: AppSettings) => Promise<void>;
  onTestAndLoadModels: (aiConfig: AppSettings["ai"]) => Promise<{
    online: boolean;
    models: AIModelInfo[];
    error?: string;
  }>;
  onMindChange?: (mind: NikaMindState) => void;
}

const TABS: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
  { id: "ai", label: "AI & Model", icon: <Cpu size={15} /> },
  { id: "persona", label: "Persona", icon: <Sparkles size={15} /> },
  { id: "voice", label: "Voice & Audio", icon: <Mic size={15} /> },
  { id: "memory", label: "Mood & Memory", icon: <Brain size={15} /> },
  { id: "system", label: "Tampilan", icon: <Sliders size={15} /> }
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  models,
  onClose,
  onLiveUpdate,
  onTestAndLoadModels,
  onMindChange
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("ai");
  const [draft, setDraft] = useState<AppSettings>(() => structuredClone(settings));
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [syncState, setSyncState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testingModels, setTestingModels] = useState(false);
  const [modelStatus, setModelStatus] = useState<string | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [mind, setMind] = useState<NikaMindState | null>(null);
  const [newMemoryText, setNewMemoryText] = useState("");
  const [speakers, setSpeakers] = useState<Array<{ id: string; label: string; samples: number }>>([]);
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    void navigator.mediaDevices.enumerateDevices().then((devices) => {
      setAudioInputs(devices.filter((d) => d.kind === "audioinput"));
    });
    if (window.nikaAPI?.getMemorySnapshot) {
      void window.nikaAPI.getMemorySnapshot().then((snap) => {
        setMemories(snap.memories);
        setMind(snap.mind);
      });
    }
    void fetch(`http://${settings.voice.host}:${settings.voice.port}/speakers`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { speakers?: Array<{ id: string; label: string; samples: number }> } | null) => {
        if (d?.speakers) setSpeakers(d.speakers);
      })
      .catch(() => {});
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const commitUpdate = async (next: AppSettings) => {
    setSyncState("saving");
    setSaveError(null);
    try {
      await onLiveUpdate(next);
      setSyncState("saved");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSyncState("idle");
    }
  };

  const applyInstant = (next: AppSettings) => {
    setDraft(next);
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    void commitUpdate(next);
  };

  const applyDebounced = (next: AppSettings) => {
    setDraft(next);
    setSyncState("saving");
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      void commitUpdate(next);
    }, 280);
  };

  const handleTestModels = async () => {
    setTestingModels(true);
    setModelStatus(null);
    try {
      const result = await onTestAndLoadModels(draft.ai);
      if (!result.online) {
        setModelStatus(result.error || "9Router offline or API key rejected");
      } else if (result.models.length === 0) {
        setModelStatus("Connected, but 0 models returned by 9Router");
      } else {
        setModelStatus(`Terhubung — ${result.models.length} model tersedia`);
      }
    } finally {
      setTestingModels(false);
    }
  };

  const handlePresetChange = (presetId: PersonaPresetId) => {
    const found = PERSONA_PRESETS.find((p) => p.id === presetId);
    const next: AppSettings = found
      ? {
          ...draft,
          persona: { ...draft.persona, preset: presetId, ...found.config }
        }
      : {
          ...draft,
          persona: { ...draft.persona, preset: presetId }
        };
    applyInstant(next);
  };

  const handleAddMemory = async () => {
    const clean = newMemoryText.trim();
    if (!clean || !window.nikaAPI?.addMemory) return;
    const added = await window.nikaAPI.addMemory({
      content: clean,
      category: "fact",
      importance: 4
    });
    if (added) {
      setNewMemoryText("");
      const snap = await window.nikaAPI.getMemorySnapshot();
      setMemories(snap.memories);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    if (!window.nikaAPI?.deleteMemory) return;
    await window.nikaAPI.deleteMemory(id);
    setMemories((prev) => prev.filter((m) => m.id !== id));
  };

  const handleClearMemories = async () => {
    if (!window.nikaAPI?.clearMemories) return;
    await window.nikaAPI.clearMemories();
    setMemories([]);
  };

  const handleResetMind = async () => {
    if (!window.nikaAPI?.resetMind) return;
    const reset = await window.nikaAPI.resetMind();
    setMind(reset);
    onMindChange?.(reset);
  };

  const currentTabTitle = TABS.find((t) => t.id === activeTab)?.label ?? "Settings";

  return (
    <div className="nika-modal-backdrop" onClick={onClose}>
      <div className="nika-settings-shell" onClick={(e) => e.stopPropagation()}>
        <aside className="nika-settings-nav">
          <div className="nika-settings-nav-title">Pengaturan NIKA</div>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`nika-nav-item ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </aside>

        <section className="nika-settings-body">
          <header className="nika-settings-header">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#f8fafc" }}>
                {currentTabTitle}
              </span>
              {syncState === "saving" && (
                <span style={{ fontSize: 11.5, color: "#7dd3fc" }}>Menyimpan...</span>
              )}
              {syncState === "saved" && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11.5,
                    color: "#34d399"
                  }}
                >
                  <Check size={12} /> Tersimpan real-time
                </span>
              )}
            </div>
            <button className="nika-btn" type="button" onClick={onClose} title="Tutup">
              <X size={14} /> Tutup
            </button>
          </header>

          <div className="nika-settings-content">
            {saveError && (
              <div
                className="nika-card"
                style={{ borderColor: "rgba(251,113,133,0.45)", color: "#fecdd3", fontSize: 12 }}
              >
                Gagal sinkron: {saveError}
              </div>
            )}

            {activeTab === "ai" && (
              <>
                <div className="nika-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>9Router AI Gateway</div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>
                      {modelStatus || "Uji koneksi & muat daftar model aktif"}
                    </div>
                  </div>
                  <button
                    className="nika-btn active"
                    type="button"
                    onClick={() => void handleTestModels()}
                    disabled={testingModels}
                  >
                    {testingModels ? "Memuat..." : "Test & Load Models"}
                  </button>
                </div>

                <div className="nika-field-grid">
                  <label className="nika-field">
                    Base URL
                    <input
                      className="nika-input"
                      value={draft.ai.baseUrl}
                      onChange={(e) =>
                        applyDebounced({
                          ...draft,
                          ai: { ...draft.ai, baseUrl: e.target.value }
                        })
                      }
                    />
                  </label>
                  <label className="nika-field">
                    API Key
                    <input
                      className="nika-input"
                      type="password"
                      value={draft.ai.apiKey}
                      onChange={(e) =>
                        applyDebounced({
                          ...draft,
                          ai: { ...draft.ai, apiKey: e.target.value }
                        })
                      }
                    />
                  </label>
                  <label className="nika-field">
                    Model
                    <select
                      className="nika-select"
                      value={draft.ai.model}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          ai: { ...draft.ai, model: e.target.value }
                        })
                      }
                    >
                      <option value="auto">auto (First Available)</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id} ({m.ownedBy})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="nika-field">
                    Reasoning Effort
                    <select
                      className="nika-select"
                      value={draft.ai.reasoningEffort}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          ai: {
                            ...draft.ai,
                            reasoningEffort: e.target.value as AppSettings["ai"]["reasoningEffort"]
                          }
                        })
                      }
                    >
                      <option value="none">None (Tercepat)</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                  <label className="nika-field">
                    Temperature ({draft.ai.temperature})
                    <input
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.05}
                      value={draft.ai.temperature}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          ai: { ...draft.ai, temperature: Number(e.target.value) }
                        })
                      }
                    />
                  </label>
                  <label className="nika-field">
                    Max Tokens ({draft.ai.maxTokens})
                    <input
                      type="range"
                      min={256}
                      max={4096}
                      step={128}
                      value={draft.ai.maxTokens}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          ai: { ...draft.ai, maxTokens: Number(e.target.value) }
                        })
                      }
                    />
                  </label>
                </div>
              </>
            )}

            {activeTab === "persona" && (
              <>
                <div className="nika-field-grid">
                  <label className="nika-field">
                    Preset Persona
                    <select
                      className="nika-select"
                      value={draft.persona.preset}
                      onChange={(e) => handlePresetChange(e.target.value as PersonaPresetId)}
                    >
                      {PERSONA_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                      <option value="custom">Custom</option>
                    </select>
                  </label>
                  <label className="nika-field">
                    Nama Karakter
                    <input
                      className="nika-input"
                      value={draft.persona.name}
                      onChange={(e) =>
                        applyDebounced({
                          ...draft,
                          persona: { ...draft.persona, name: e.target.value }
                        })
                      }
                    />
                  </label>
                  <label className="nika-field">
                    Panggilan ke User
                    <input
                      className="nika-input"
                      value={draft.persona.userCallName}
                      placeholder="kamu / kakak / nama"
                      onChange={(e) =>
                        applyDebounced({
                          ...draft,
                          persona: { ...draft.persona, userCallName: e.target.value }
                        })
                      }
                    />
                  </label>
                  <label className="nika-field">
                    Gaya Bicara
                    <input
                      className="nika-input"
                      value={draft.persona.speakingStyle}
                      onChange={(e) =>
                        applyDebounced({
                          ...draft,
                          persona: {
                            ...draft.persona,
                            preset: "custom",
                            speakingStyle: e.target.value
                          }
                        })
                      }
                    />
                  </label>
                </div>
                <label className="nika-field" style={{ marginBottom: 12 }}>
                  Kepribadian / Sifat
                  <textarea
                    className="nika-textarea"
                    value={draft.persona.personality}
                    onChange={(e) =>
                      applyDebounced({
                        ...draft,
                        persona: {
                          ...draft.persona,
                          preset: "custom",
                          personality: e.target.value
                        }
                      })
                    }
                  />
                </label>
                <label className="nika-field" style={{ marginBottom: 12 }}>
                  Backstory Singkat
                  <textarea
                    className="nika-textarea"
                    value={draft.persona.backstory}
                    onChange={(e) =>
                      applyDebounced({
                        ...draft,
                        persona: {
                          ...draft.persona,
                          preset: "custom",
                          backstory: e.target.value
                        }
                      })
                    }
                  />
                </label>
                <label className="nika-field">
                  Instruksi Tambahan
                  <input
                    className="nika-input"
                    value={draft.persona.customInstructions}
                    placeholder="Contoh: Suka bahas game & anime, tetap santai..."
                    onChange={(e) =>
                      applyDebounced({
                        ...draft,
                        persona: { ...draft.persona, customInstructions: e.target.value }
                      })
                    }
                  />
                </label>
              </>
            )}

            {activeTab === "voice" && (
              <>
                <div className="nika-field-grid">
                  <label className="nika-field">
                    STT Language
                    <select
                      className="nika-select"
                      value={draft.voice.sttLanguage}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          voice: {
                            ...draft.voice,
                            sttLanguage: e.target.value as AppSettings["voice"]["sttLanguage"]
                          }
                        })
                      }
                    >
                      <option value="auto">Auto Detect (ID / EN)</option>
                      <option value="id">Indonesian (id)</option>
                      <option value="en">English (en)</option>
                    </select>
                  </label>
                  <label className="nika-field">
                    STT Model
                    <select
                      className="nika-select"
                      value={draft.voice.sttModel}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          voice: { ...draft.voice, sttModel: e.target.value }
                        })
                      }
                    >
                      <option value="sherpa-zipformer-id-en">
                        Sherpa Streaming (ID + EN, Real-time)
                      </option>
                      <option value="tiny">Whisper tiny (fastest)</option>
                      <option value="base">Whisper base</option>
                      <option value="small">Whisper small</option>
                      <option value="medium">Whisper medium</option>
                      <option value="large-v3-turbo">Whisper large-v3-turbo</option>
                    </select>
                  </label>
                  <label className="nika-field">
                    VAD Sensitivity ({draft.voice.vadThreshold})
                    <input
                      type="range"
                      min={0.2}
                      max={0.8}
                      step={0.05}
                      value={draft.voice.vadThreshold}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          voice: { ...draft.voice, vadThreshold: Number(e.target.value) }
                        })
                      }
                    />
                  </label>
                  <label className="nika-field">
                    End-of-Speech Silence ({draft.voice.vadMinSilenceMs} ms)
                    <input
                      type="range"
                      min={250}
                      max={1000}
                      step={50}
                      value={draft.voice.vadMinSilenceMs}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          voice: { ...draft.voice, vadMinSilenceMs: Number(e.target.value) }
                        })
                      }
                    />
                  </label>
                  <label className="nika-field">
                    Microphone
                    <select
                      className="nika-select"
                      value={draft.voice.inputDeviceId}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          voice: { ...draft.voice, inputDeviceId: e.target.value }
                        })
                      }
                    >
                      <option value="default">System Default</option>
                      {audioInputs.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Mic ${d.deviceId.slice(0, 6)}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="nika-field">
                    Wake Word
                    <input
                      className="nika-input"
                      value={draft.voice.wakeWord}
                      onChange={(e) =>
                        applyDebounced({
                          ...draft,
                          voice: { ...draft.voice, wakeWord: e.target.value }
                        })
                      }
                    />
                  </label>
                  <label className="nika-field">
                    TTS Engine
                    <select
                      className="nika-select"
                      value={draft.voice.ttsEngine}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          voice: {
                            ...draft.voice,
                            ttsEngine: e.target.value as AppSettings["voice"]["ttsEngine"]
                          }
                        })
                      }
                    >
                      <option value="auto">Auto (Nika Pocket ID / Kokoro EN)</option>
                      <option value="pocket">Pocket TTS (Nika Voice Clone)</option>
                      <option value="piper">Piper TTS</option>
                      <option value="kokoro">Kokoro TTS</option>
                    </select>
                  </label>
                  <label className="nika-field">
                    Speaking Speed ({draft.voice.ttsSpeed}x)
                    <input
                      type="range"
                      min={0.6}
                      max={1.5}
                      step={0.05}
                      value={draft.voice.ttsSpeed}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          voice: { ...draft.voice, ttsSpeed: Number(e.target.value) }
                        })
                      }
                    />
                  </label>
                  <label className="nika-field">
                    Jeda Napas Antar Kalimat ({draft.voice.sentencePauseMs ?? 480} ms)
                    <input
                      type="range"
                      min={100}
                      max={2000}
                      step={50}
                      value={draft.voice.sentencePauseMs ?? 480}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          voice: { ...draft.voice, sentencePauseMs: Number(e.target.value) }
                        })
                      }
                    />
                  </label>
                  <label className="nika-field">
                    Tarik Napas Natural
                    <select
                      className="nika-select"
                      value={(draft.voice.breathAudioEnabled ?? true) ? "true" : "false"}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          voice: { ...draft.voice, breathAudioEnabled: e.target.value === "true" }
                        })
                      }
                    >
                      <option value="true">Aktif (Natural Inhale)</option>
                      <option value="false">Nonaktif (Hening Saja)</option>
                    </select>
                  </label>
                  <label className="nika-field">
                    Volume Tarik Napas ({Math.round((draft.voice.breathVolume ?? 0.1) * 100)}%)
                    <input
                      type="range"
                      min={0}
                      max={0.5}
                      step={0.02}
                      value={draft.voice.breathVolume ?? 0.1}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          voice: { ...draft.voice, breathVolume: Number(e.target.value) }
                        })
                      }
                    />
                  </label>
                  <label className="nika-field">
                    Potong Ucapan (Speech Interruption)
                    <select
                      className="nika-select"
                      value={(draft.voice.bargeInEnabled ?? true) ? "true" : "false"}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          voice: { ...draft.voice, bargeInEnabled: e.target.value === "true" }
                        })
                      }
                    >
                      <option value="true">Aktif (Boleh Potong Ucapan)</option>
                      <option value="false">Nonaktif</option>
                    </select>
                  </label>
                  <label className="nika-field">
                    Filter Pembicara (Voice Privacy)
                    <select
                      className="nika-select"
                      value={(draft.voice.ownerOnlyMode ?? false) ? "true" : "false"}
                      onChange={(e) =>
                        applyInstant({
                          ...draft,
                          voice: { ...draft.voice, ownerOnlyMode: e.target.value === "true" }
                        })
                      }
                    >
                      <option value="false">Semua Orang</option>
                      <option value="true">Hanya Pemilik (Speaker 1)</option>
                    </select>
                  </label>
                </div>

                <div className="nika-card">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                      Pengenalan Suara Pembicara (Speaker Recognition)
                    </div>
                    {speakers.length > 0 && (
                      <button
                        className="nika-btn danger"
                        type="button"
                        onClick={async () => {
                          await fetch(`http://${draft.voice.host}:${draft.voice.port}/speakers`, {
                            method: "DELETE"
                          }).catch(() => {});
                          setSpeakers([]);
                        }}
                      >
                        Reset Speaker
                      </button>
                    )}
                  </div>
                  {speakers.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>
                      Belum ada profil suara terekam. Bicara lewat mic agar Nika otomatis mengenali dan membedakan suara orang.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {speakers.map((s) => (
                        <div key={s.id} className="nika-boot-row" style={{ gap: 10 }}>
                          <input
                            className="nika-input"
                            style={{ flex: 1, minWidth: 0, maxWidth: 240, padding: "4px 8px" }}
                            value={s.label}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSpeakers((prev) =>
                                prev.map((item) => (item.id === s.id ? { ...item, label: val } : item))
                              );
                            }}
                            onBlur={(e) => {
                              void fetch(
                                `http://${draft.voice.host}:${draft.voice.port}/speakers/rename`,
                                {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ id: s.id, label: e.target.value })
                                }
                              ).catch(() => {});
                            }}
                          />
                          <span style={{ fontSize: 11.5, color: "#94a3b8" }}>
                            {s.samples} sampel suara
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === "memory" && (
              <>
                {mind && (
                  <div className="nika-card">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                      <div>
                        <span style={{ fontSize: 12, color: "#94a3b8" }}>Mood Saat Ini: </span>
                        <strong style={{ fontSize: 14, color: "#7dd3fc" }}>{mind.mood}</strong>
                      </div>
                      <button className="nika-btn" type="button" onClick={() => void handleResetMind()}>
                        Reset Mood
                      </button>
                    </div>
                    <div className="nika-field-grid" style={{ marginBottom: 0 }}>
                      {[
                        { label: "Happiness", val: mind.happiness },
                        { label: "Affection", val: mind.affection },
                        { label: "Energy", val: mind.energy },
                        { label: "Trust", val: mind.trust }
                      ].map((m) => (
                        <div key={m.label}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                            <span style={{ color: "#cbd5e1" }}>{m.label}</span>
                            <span style={{ color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>{m.val}%</span>
                          </div>
                          <div className="nika-meter-track">
                            <div className="nika-meter-fill" style={{ width: `${m.val}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <input
                    className="nika-input"
                    placeholder="Tambah memori baru tentangmu..."
                    value={newMemoryText}
                    onChange={(e) => setNewMemoryText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleAddMemory();
                      }
                    }}
                  />
                  <button className="nika-btn active" type="button" onClick={() => void handleAddMemory()}>
                    Tambah
                  </button>
                  {memories.length > 0 && (
                    <button className="nika-btn danger" type="button" onClick={() => void handleClearMemories()}>
                      Hapus Semua
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {memories.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: "#94a3b8", padding: "12px 0" }}>
                      Belum ada memori tersimpan. Nika otomatis mengingat fakta penting saat ngobrol.
                    </div>
                  ) : (
                    memories.map((m) => (
                      <div
                        key={m.id}
                        className="nika-boot-row"
                        style={{ padding: "8px 12px" }}
                      >
                        <span>
                          <strong style={{ color: "#c084fc", marginRight: 8 }}>[{m.category}]</strong>
                          {m.content}
                        </span>
                        <button
                          className="nika-btn"
                          type="button"
                          style={{ padding: "2px 8px" }}
                          onClick={() => void handleDeleteMemory(m.id)}
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {activeTab === "system" && (
              <div className="nika-field-grid">
                <label className="nika-field">
                  Bahasa Utama
                  <select
                    className="nika-select"
                    value={draft.ui.language}
                    onChange={(e) =>
                      applyInstant({
                        ...draft,
                        ui: { ...draft.ui, language: e.target.value as "id" | "en" }
                      })
                    }
                  >
                    <option value="id">Indonesia</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label className="nika-field">
                  Always on Top
                  <select
                    className="nika-select"
                    value={draft.ui.alwaysOnTop ? "true" : "false"}
                    onChange={(e) =>
                      applyInstant({
                        ...draft,
                        ui: { ...draft.ui, alwaysOnTop: e.target.value === "true" }
                      })
                    }
                  >
                    <option value="false">Normal Window</option>
                    <option value="true">Selalu di Atas (Always on Top)</option>
                  </select>
                </label>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

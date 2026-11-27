import React, { useEffect, useState } from "react";
import { PERSONA_PRESETS } from "../../shared/personaPresets";
import type {
  AIModelInfo,
  AppSettings,
  MemoryItem,
  NikaMindState,
  PersonaPresetId
} from "../../shared/types/index";

interface SettingsModalProps {
  settings: AppSettings;
  models: AIModelInfo[];
  onClose: () => void;
  onSave: (updated: AppSettings) => Promise<void>;
  onTestAndLoadModels: (aiConfig: AppSettings["ai"]) => Promise<{
    online: boolean;
    models: AIModelInfo[];
    error?: string;
  }>;
  onMindChange?: (mind: NikaMindState) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  models,
  onClose,
  onSave,
  onTestAndLoadModels,
  onMindChange
}) => {
  const [draft, setDraft] = useState<AppSettings>(() => structuredClone(settings));
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testingModels, setTestingModels] = useState(false);
  const [modelStatus, setModelStatus] = useState<string | null>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [mind, setMind] = useState<NikaMindState | null>(null);
  const [newMemoryText, setNewMemoryText] = useState("");

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
  }, []);

  const handlePresetChange = (presetId: PersonaPresetId) => {
    const found = PERSONA_PRESETS.find((p) => p.id === presetId);
    if (!found) {
      setDraft({ ...draft, persona: { ...draft.persona, preset: presetId } });
      return;
    }
    setDraft({
      ...draft,
      persona: {
        ...draft.persona,
        preset: presetId,
        ...found.config
      }
    });
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

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
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
        setModelStatus(`Connected — ${result.models.length} model(s) loaded`);
      }
    } finally {
      setTestingModels(false);
    }
  };

  return (
    <div className="nika-modal-backdrop" onClick={onClose}>
      <div className="nika-modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0, color: "#67e8f9" }}>NIKA Settings</h3>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h4 style={{ margin: 0, color: "#c084fc" }}>9Router AI Gateway</h4>
          <button
            className="nika-btn"
            type="button"
            onClick={() => void handleTestModels()}
            disabled={testingModels}
          >
            {testingModels ? "Loading..." : "Test & Load Models"}
          </button>
        </div>
        {modelStatus && (
          <div style={{ fontSize: 12, marginBottom: 10, color: "#67e8f9" }}>{modelStatus}</div>
        )}
        <div className="nika-field-grid">
          <label className="nika-field">
            Base URL
            <input
              className="nika-input"
              value={draft.ai.baseUrl}
              onChange={(e) =>
                setDraft({ ...draft, ai: { ...draft.ai, baseUrl: e.target.value } })
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
                setDraft({ ...draft, ai: { ...draft.ai, apiKey: e.target.value } })
              }
            />
          </label>
          <label className="nika-field">
            Model
            <select
              className="nika-select"
              value={draft.ai.model}
              onChange={(e) =>
                setDraft({ ...draft, ai: { ...draft.ai, model: e.target.value } })
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
            Temperature ({draft.ai.temperature})
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={draft.ai.temperature}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  ai: { ...draft.ai, temperature: Number(e.target.value) }
                })
              }
            />
          </label>
        </div>

        <h4 style={{ marginBottom: 8, color: "#c084fc" }}>Local STT & VAD (100% Local)</h4>
        <div className="nika-field-grid">
          <label className="nika-field">
            STT Language
            <select
              className="nika-select"
              value={draft.voice.sttLanguage}
              onChange={(e) =>
                setDraft({
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
                setDraft({
                  ...draft,
                  voice: { ...draft.voice, sttModel: e.target.value }
                })
              }
            >
              <option value="sherpa-zipformer-id-en">Sherpa Streaming (ID + EN, Real-time)</option>
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
                setDraft({
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
                setDraft({
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
                setDraft({
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
                setDraft({
                  ...draft,
                  voice: { ...draft.voice, wakeWord: e.target.value }
                })
              }
            />
          </label>
        </div>

        <h4 style={{ marginBottom: 8, color: "#c084fc" }}>Local TTS (100% Local)</h4>
        <div className="nika-field-grid">
          <label className="nika-field">
            TTS Engine
            <select
              className="nika-select"
              value={draft.voice.ttsEngine}
              onChange={(e) =>
                setDraft({
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
                setDraft({
                  ...draft,
                  voice: { ...draft.voice, ttsSpeed: Number(e.target.value) }
                })
              }
            />
          </label>
          <label className="nika-field">
            Indonesian Voice (Piper)
            <input
              className="nika-input"
              value={draft.voice.ttsVoiceId}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  voice: { ...draft.voice, ttsVoiceId: e.target.value }
                })
              }
            />
          </label>
          <label className="nika-field">
            English Voice (Kokoro)
            <input
              className="nika-input"
              value={draft.voice.ttsVoiceEn}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  voice: { ...draft.voice, ttsVoiceEn: e.target.value }
                })
              }
            />
          </label>
        </div>

        <h4 style={{ marginBottom: 8, color: "#c084fc" }}>Persona & Karakter Nika</h4>
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
                setDraft({
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
                setDraft({
                  ...draft,
                  persona: { ...draft.persona, userCallName: e.target.value }
                })
              }
            />
          </label>
          <label className="nika-field">
            Kepribadian / Sifat
            <input
              className="nika-input"
              value={draft.persona.personality}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  persona: { ...draft.persona, preset: "custom", personality: e.target.value }
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
                setDraft({
                  ...draft,
                  persona: { ...draft.persona, preset: "custom", speakingStyle: e.target.value }
                })
              }
            />
          </label>
          <label className="nika-field">
            Backstory Singkat
            <input
              className="nika-input"
              value={draft.persona.backstory}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  persona: { ...draft.persona, preset: "custom", backstory: e.target.value }
                })
              }
            />
          </label>
        </div>
        <label className="nika-field" style={{ marginTop: 8 }}>
          Instruksi Tambahan Persona
          <input
            className="nika-input"
            value={draft.persona.customInstructions}
            placeholder="Contoh: Suka bahas anime, jangan terlalu formal..."
            onChange={(e) =>
              setDraft({
                ...draft,
                persona: { ...draft.persona, customInstructions: e.target.value }
              })
            }
          />
        </label>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, marginBottom: 8 }}>
          <h4 style={{ margin: 0, color: "#c084fc" }}>Mood, Perasaan & Memory</h4>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="nika-btn" type="button" onClick={() => void handleResetMind()}>
              Reset Mood
            </button>
            {memories.length > 0 && (
              <button className="nika-btn" type="button" onClick={() => void handleClearMemories()}>
                Hapus Semua Memori
              </button>
            )}
          </div>
        </div>

        {mind && (
          <div style={{ fontSize: 12, color: "#e2e8f0", marginBottom: 10, display: "flex", flexWrap: "wrap", gap: 12 }}>
            <span>Mood: <strong style={{ color: "#67e8f9" }}>{mind.mood}</strong></span>
            <span>Happiness: {mind.happiness}%</span>
            <span>Affection: {mind.affection}%</span>
            <span>Energy: {mind.energy}%</span>
            <span>Trust: {mind.trust}%</span>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            className="nika-input"
            style={{ flex: 1 }}
            placeholder="Tambah memori tentangmu (mis. Aku suka kopi susu)..."
            value={newMemoryText}
            onChange={(e) => setNewMemoryText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAddMemory();
              }
            }}
          />
          <button className="nika-btn" type="button" onClick={() => void handleAddMemory()}>
            Tambah
          </button>
        </div>

        <div style={{ maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {memories.length === 0 ? (
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              Belum ada memori tersimpan. Nika otomatis mengingat fakta penting saat ngobrol.
            </div>
          ) : (
            memories.map((m) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 12,
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.04)"
                }}
              >
                <span>
                  <strong style={{ color: "#c084fc", marginRight: 6 }}>[{m.category}]</strong>
                  {m.content}
                </span>
                <button
                  className="nika-btn"
                  type="button"
                  style={{ padding: "2px 6px", fontSize: 11 }}
                  onClick={() => void handleDeleteMemory(m.id)}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        {saveError && (
          <div style={{ fontSize: 12, marginTop: 10, color: "#fca5a5" }}>
            Failed to save: {saveError}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <button className="nika-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="nika-btn active" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save & Apply"}
          </button>
        </div>
      </div>
    </div>
  );
};

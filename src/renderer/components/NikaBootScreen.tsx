import React from "react";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import type { SystemReadiness } from "../../shared/types/index";

interface NikaBootScreenProps {
  readiness: SystemReadiness | null;
  allowSkip: boolean;
  onContinue: () => void;
}

export const NikaBootScreen: React.FC<NikaBootScreenProps> = ({
  readiness,
  allowSkip,
  onContinue
}) => {
  const voiceReady = Boolean(
    readiness?.voice.vadReady && readiness?.voice.sttReady && readiness?.voice.ttsReady
  );

  const steps = [
    {
      label: "Config & Persona",
      done: Boolean(readiness?.configReady),
      detail: readiness?.configReady ? "Siap" : "Memuat..."
    },
    {
      label: "Memory & Mood Engine",
      done: Boolean(readiness?.memoryReady),
      detail: readiness?.memoryReady ? "Aktif" : "Memuat..."
    },
    {
      label: "Agent Tools & Browser (Vercel)",
      done: Boolean(readiness?.toolsCount && readiness.toolsCount > 0),
      detail: readiness?.agentBrowserReady
        ? `${readiness.toolsCount} tools siap`
        : "Menyiapkan..."
    },
    {
      label: "Voice Engine (VAD · STT · TTS)",
      done: voiceReady,
      detail: voiceReady
        ? readiness?.voice.activeTtsEngines.join(" / ") || "Siap"
        : "Memuat model lokal..."
    },
    {
      label: "9Router AI Gateway",
      done: Boolean(readiness?.routerOnline),
      detail: readiness?.routerOnline ? "Online" : "Menunggu koneksi..."
    }
  ];

  const completed = steps.filter((s) => s.done).length;
  const pct = Math.round((completed / steps.length) * 100);

  return (
    <div className="nika-boot-overlay">
      <div className="nika-boot-card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "linear-gradient(135deg, rgba(168,85,247,0.35), rgba(56,189,248,0.3))",
              border: "1px solid rgba(255,255,255,0.14)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <Sparkles size={20} color="#7dd3fc" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#f8fafc" }}>
              Menyiapkan NIKA
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              Memastikan semua modul & tool AI siap sebelum mulai...
            </div>
          </div>
        </div>

        <div className="nika-meter-track" style={{ height: 7, marginBottom: 16 }}>
          <div className="nika-meter-fill" style={{ width: `${pct}%` }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {steps.map((step) => (
            <div key={step.label} className="nika-boot-row">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {step.done ? (
                  <CheckCircle2 size={15} color="#34d399" />
                ) : (
                  <Loader2 size={15} color="#7dd3fc" className="nika-spin" />
                )}
                <span style={{ color: step.done ? "#f8fafc" : "#cbd5e1" }}>
                  {step.label}
                </span>
              </div>
              <span
                style={{
                  fontSize: 11.5,
                  color: step.done ? "#34d399" : "#94a3b8"
                }}
              >
                {step.detail}
              </span>
            </div>
          ))}
        </div>

        {allowSkip && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button className="nika-btn" type="button" onClick={onContinue}>
              Lanjutkan Sekarang
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

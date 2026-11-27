from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import numpy as np


def _estimate_pitch_hz(audio: np.ndarray, sr: int = 16000) -> float:
    """Estimate fundamental pitch (F0) via autocorrelation on voiced frames."""
    if audio.size < 1600:
        return 0.0
    frame_len = 512
    hop = 256
    pitches: list[float] = []
    min_lag = max(1, int(sr / 360))  # 360 Hz max
    max_lag = min(frame_len - 1, int(sr / 75))  # 75 Hz min

    for start in range(0, audio.size - frame_len, hop):
        frame = audio[start : start + frame_len]
        energy = float(np.mean(frame * frame))
        if energy < 0.0008:
            continue
        frame = frame - float(np.mean(frame))
        corr = np.correlate(frame, frame, mode="full")[frame_len - 1 :]
        if corr[0] <= 1e-8:
            continue
        seg = corr[min_lag:max_lag]
        if seg.size == 0:
            continue
        peak_idx = int(np.argmax(seg))
        peak_val = float(seg[peak_idx]) / float(corr[0])
        if peak_val > 0.35:
            lag = min_lag + peak_idx
            pitches.append(float(sr) / float(lag))

    if not pitches:
        return 0.0
    return float(np.median(pitches))


def _extract_voiceprint(audio: np.ndarray, sr: int = 16000) -> np.ndarray:
    """Compute a compact 16-dim acoustic voiceprint (spectral bands + pitch + zcr)."""
    if audio.size < 3200:
        return np.zeros(16, dtype=np.float32)

    # Take up to 4 seconds of voiced audio
    max_samples = sr * 4
    if audio.size > max_samples:
        audio = audio[:max_samples]

    frame_len = 512
    hop = 256
    window = np.hanning(frame_len).astype(np.float32)
    band_energies = np.zeros(13, dtype=np.float64)
    zcr_list: list[float] = []
    frames_used = 0

    freqs = np.fft.rfftfreq(frame_len, d=1.0 / sr)
    band_edges = np.geomspace(80.0, 7600.0, num=14)

    for start in range(0, audio.size - frame_len, hop):
        frame = audio[start : start + frame_len]
        rms = float(np.sqrt(np.mean(frame * frame)))
        if rms < 0.015:
            continue
        frames_used += 1
        zcr = float(np.mean(np.abs(np.diff(np.signbit(frame)))))
        zcr_list.append(zcr)

        spec = np.abs(np.fft.rfft(frame * window)) + 1e-8
        log_spec = np.log1p(spec)
        for b in range(13):
            mask = (freqs >= band_edges[b]) & (freqs < band_edges[b + 1])
            if np.any(mask):
                band_energies[b] += float(np.mean(log_spec[mask]))

    if frames_used == 0:
        return np.zeros(16, dtype=np.float32)

    band_energies /= frames_used
    pitch_hz = _estimate_pitch_hz(audio, sr)
    mean_zcr = float(np.mean(zcr_list)) if zcr_list else 0.0
    spectral_centroid = float(
        np.sum(band_energies * np.arange(1, 14)) / (np.sum(band_energies) + 1e-8)
    )

    vec = np.concatenate(
        [
            band_energies,
            np.array([pitch_hz / 300.0, mean_zcr * 4.0, spectral_centroid / 13.0]),
        ]
    ).astype(np.float32)

    norm = float(np.linalg.norm(vec))
    if norm > 1e-6:
        vec /= norm
    return vec


class VoiceAnalyzer:
    """Analyzes vocal emotion (prosody) and distinguishes speakers via acoustic voiceprints."""

    def __init__(self, store_path: Path | None = None) -> None:
        self.store_path = store_path or (
            Path(__file__).resolve().parent / "models" / "speakers.json"
        )
        self.store_path.parent.mkdir(parents=True, exist_ok=True)
        self.speakers: list[dict[str, Any]] = self._load_speakers()

    def _load_speakers(self) -> list[dict[str, Any]]:
        if not self.store_path.exists():
            return []
        try:
            data = json.loads(self.store_path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return data
        except Exception:
            pass
        return []

    def _save_speakers(self) -> None:
        self.store_path.write_text(
            json.dumps(self.speakers, indent=2), encoding="utf-8"
        )

    def list_speakers(self) -> list[dict[str, Any]]:
        return [
            {
                "id": s["id"],
                "label": s["label"],
                "samples": s.get("samples", 1),
                "lastSeen": s.get("lastSeen", 0),
            }
            for s in self.speakers
        ]

    def rename_speaker(self, speaker_id: str, new_label: str) -> bool:
        clean = new_label.strip()
        if not clean:
            return False
        for s in self.speakers:
            if s["id"] == speaker_id:
                s["label"] = clean
                self._save_speakers()
                return True
        return False

    def clear_speakers(self) -> None:
        self.speakers = []
        self._save_speakers()

    def analyze_emotion(
        self, audio: np.ndarray, sr: int = 16000
    ) -> dict[str, Any]:
        if audio.size < 1600:
            return {"emotion": "neutral", "energy": 0.0, "pitchHz": 0.0}

        rms = float(np.sqrt(np.mean(np.square(audio))))
        peak = float(np.max(np.abs(audio)))
        zcr = float(np.mean(np.abs(np.diff(np.signbit(audio)))))
        pitch_hz = _estimate_pitch_hz(audio, sr)

        emotion = "neutral"
        if rms >= 0.075 and zcr >= 0.14 and peak >= 0.65:
            emotion = "angry"
        elif (rms >= 0.055 and pitch_hz >= 175) or (peak >= 0.55 and pitch_hz >= 195):
            emotion = "excited"
        elif rms <= 0.022 and (pitch_hz == 0 or pitch_hz <= 145):
            emotion = "sad"
        elif rms <= 0.032:
            emotion = "calm"

        return {
            "emotion": emotion,
            "energy": round(rms, 4),
            "pitchHz": round(pitch_hz, 1),
        }

    def identify_speaker(
        self, audio: np.ndarray, sr: int = 16000
    ) -> dict[str, Any]:
        if audio.size < int(sr * 0.65):
            if self.speakers:
                first = self.speakers[0]
                return {
                    "id": first["id"],
                    "label": first["label"],
                    "confidence": 0.7,
                    "isNew": False,
                }
            return {"id": "spk-1", "label": "Speaker 1", "confidence": 0.5, "isNew": False}

        vec = _extract_voiceprint(audio, sr)
        if float(np.linalg.norm(vec)) < 1e-6:
            return {"id": "spk-1", "label": "Speaker 1", "confidence": 0.5, "isNew": False}

        best_idx = -1
        best_sim = -1.0
        for idx, spk in enumerate(self.speakers):
            emb = np.array(spk["embedding"], dtype=np.float32)
            sim = float(np.dot(vec, emb))
            if sim > best_sim:
                best_sim = sim
                best_idx = idx

        threshold = 0.87
        now = int(time.time() * 1000)
        if best_idx >= 0 and best_sim >= threshold:
            spk = self.speakers[best_idx]
            old_emb = np.array(spk["embedding"], dtype=np.float32)
            updated = old_emb * 0.85 + vec * 0.15
            norm = float(np.linalg.norm(updated))
            if norm > 1e-6:
                updated /= norm
            spk["embedding"] = updated.tolist()
            spk["samples"] = int(spk.get("samples", 1)) + 1
            spk["lastSeen"] = now
            self._save_speakers()
            return {
                "id": spk["id"],
                "label": spk["label"],
                "confidence": round(best_sim, 3),
                "isNew": False,
            }

        new_num = len(self.speakers) + 1
        new_spk = {
            "id": f"spk-{new_num}",
            "label": "Speaker 1 (Kamu)" if new_num == 1 else f"Speaker {new_num}",
            "embedding": vec.tolist(),
            "samples": 1,
            "lastSeen": now,
        }
        self.speakers.append(new_spk)
        self._save_speakers()
        return {
            "id": new_spk["id"],
            "label": new_spk["label"],
            "confidence": 1.0,
            "isNew": True,
        }

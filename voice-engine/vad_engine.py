from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
import numpy as np


@dataclass
class VADResult:
    speech_prob: float
    is_speech: bool
    event: Optional[str] = None  # "speech_start" | "speech_end" | None
    audio_segment: Optional[np.ndarray] = None


class SileroVADEngine:
    """Local Silero VAD engine operating on 16kHz mono float32 frames (512 samples)."""

    SAMPLE_RATE = 16000
    FRAME_SAMPLES = 512
    MAX_SPEECH_SAMPLES = 15 * 16000
    MIN_SPEECH_FRAMES = 3  # ~96ms sustained speech required to filter clicks/pops

    def __init__(self, threshold: float = 0.45, min_silence_ms: int = 450) -> None:
        self.threshold = threshold
        self.min_silence_ms = min_silence_ms
        self._model = None
        self._ready = False

        self._in_speech = False
        self._speech_onset_count = 0
        self._silence_samples = 0
        self._pre_roll: list[np.ndarray] = []
        self._speech_frames: list[np.ndarray] = []
        self._pending = np.zeros(0, dtype=np.float32)

    def load(self) -> None:
        from silero_vad import load_silero_vad
        self._model = load_silero_vad(onnx=True)
        self._ready = True

    @property
    def is_ready(self) -> bool:
        return self._ready

    def update_config(self, threshold: Optional[float] = None, min_silence_ms: Optional[int] = None) -> None:
        if threshold is not None:
            self.threshold = float(threshold)
        if min_silence_ms is not None:
            self.min_silence_ms = int(min_silence_ms)

    def reset(self) -> None:
        self._in_speech = False
        self._speech_onset_count = 0
        self._silence_samples = 0
        self._pre_roll.clear()
        self._speech_frames.clear()
        self._pending = np.zeros(0, dtype=np.float32)
        if self._model is not None and hasattr(self._model, "reset_states"):
            self._model.reset_states()

    def process_pcm16(self, pcm_bytes: bytes) -> list[VADResult]:
        if not self._ready or self._model is None:
            return []

        pcm_int16 = np.frombuffer(pcm_bytes, dtype=np.int16)
        if pcm_int16.size == 0:
            return []

        samples = pcm_int16.astype(np.float32) / 32768.0
        self._pending = np.concatenate([self._pending, samples])

        results: list[VADResult] = []
        min_silence_samples = int((self.min_silence_ms / 1000.0) * self.SAMPLE_RATE)

        while self._pending.size >= self.FRAME_SAMPLES:
            frame = self._pending[: self.FRAME_SAMPLES]
            self._pending = self._pending[self.FRAME_SAMPLES :]

            import torch
            rms = float(np.sqrt(np.mean(np.square(frame))))
            if rms < 0.004:
                prob = 0.0
            else:
                with torch.no_grad():
                    tensor = torch.from_numpy(frame).unsqueeze(0)
                    prob = float(self._model(tensor, self.SAMPLE_RATE).item())
            is_speech = prob >= self.threshold

            if not self._in_speech:
                self._pre_roll.append(frame)
                if len(self._pre_roll) > 10:  # ~320ms pre-roll
                    self._pre_roll.pop(0)

                if is_speech:
                    self._speech_onset_count += 1
                    if self._speech_onset_count >= self.MIN_SPEECH_FRAMES:
                        self._in_speech = True
                        self._speech_onset_count = 0
                        self._silence_samples = 0
                        self._speech_frames = list(self._pre_roll)
                        self._speech_frames.append(frame)
                        results.append(VADResult(speech_prob=prob, is_speech=True, event="speech_start"))
                    else:
                        results.append(VADResult(speech_prob=prob, is_speech=False))
                else:
                    self._speech_onset_count = 0
                    results.append(VADResult(speech_prob=prob, is_speech=False))
            else:
                self._speech_frames.append(frame)
                if is_speech:
                    self._silence_samples = 0
                    results.append(VADResult(speech_prob=prob, is_speech=True))
                else:
                    self._silence_samples += self.FRAME_SAMPLES
                    max_reached = len(self._speech_frames) * self.FRAME_SAMPLES >= self.MAX_SPEECH_SAMPLES
                    if self._silence_samples >= min_silence_samples or max_reached:
                        segment = np.concatenate(self._speech_frames)
                        self._in_speech = False
                        self._silence_samples = 0
                        self._speech_frames.clear()
                        self._pre_roll.clear()
                        results.append(
                            VADResult(
                                speech_prob=prob,
                                is_speech=False,
                                event="speech_end",
                                audio_segment=segment,
                            )
                        )
                    else:
                        results.append(VADResult(speech_prob=prob, is_speech=True))

        return results

    def get_current_buffer(self) -> Optional[np.ndarray]:
        if not self._speech_frames:
            return None
        return np.concatenate(self._speech_frames)

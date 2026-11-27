from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
import numpy as np


@dataclass
class TranscriptionResult:
    text: str
    language: str
    confidence: float
    is_partial: bool = False


class FasterWhisperSTTEngine:
    """Local STT powered by faster-whisper (CTranslate2 int8 CPU)."""

    def __init__(
        self,
        model_name: str = "small",
        device: str = "cpu",
        compute_type: str = "int8",
        language: str = "auto",
    ) -> None:
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type
        self.language = language
        self._model = None
        self._ready = False

    def load(self) -> None:
        from faster_whisper import WhisperModel

        self._model = WhisperModel(
            self.model_name,
            device=self.device,
            compute_type=self.compute_type,
            cpu_threads=min(8, os.cpu_count() or 4),
        )
        self._ready = True

    @property
    def is_ready(self) -> bool:
        return self._ready

    def update_config(
        self,
        language: Optional[str] = None,
        model_name: Optional[str] = None,
    ) -> None:
        if language is not None:
            self.language = language
        if model_name is not None and model_name != self.model_name:
            self.model_name = model_name
            self._ready = False
            self.load()

    def transcribe(
        self,
        audio: np.ndarray,
        is_partial: bool = False,
    ) -> TranscriptionResult:
        if not self._ready or self._model is None:
            return TranscriptionResult(text="", language="unknown", confidence=0.0, is_partial=is_partial)

        # Skip near-silent segments
        rms = float(np.sqrt(np.mean(np.square(audio)))) if audio.size > 0 else 0.0
        if rms < 0.005:
            return TranscriptionResult(text="", language="unknown", confidence=0.0, is_partial=is_partial)

        # Gentle peak normalization so quiet mics are clearer for Whisper
        peak = float(np.max(np.abs(audio)))
        if 0.01 < peak < 0.35:
            audio = np.clip(audio * (0.5 / peak), -1.0, 1.0).astype(np.float32)

        lang_arg = None if self.language in ("auto", "", None) else self.language
        beam_size = 1 if is_partial else 2
        prompt = (
            "Percakapan santai dalam bahasa Indonesia dan English dengan Nika."
            if self.language in ("auto", "id", "", None)
            else None
        )

        segments, info = self._model.transcribe(
            audio,
            language=lang_arg,
            beam_size=beam_size,
            best_of=1,
            initial_prompt=prompt,
            vad_filter=False,
            no_speech_threshold=0.6,
            condition_on_previous_text=False,
        )

        kept_texts: list[str] = []
        for seg in segments:
            no_speech = getattr(seg, "no_speech_prob", 0.0) or 0.0
            avg_logprob = getattr(seg, "avg_logprob", 0.0) or 0.0
            if no_speech > 0.7 or avg_logprob < -1.2:
                continue
            cleaned = seg.text.strip()
            if cleaned:
                kept_texts.append(cleaned)

        text = " ".join(kept_texts).strip()
        detected_lang = getattr(info, "language", None) or (lang_arg or "id")
        lang_prob = float(getattr(info, "language_probability", 0.9) or 0.9)

        return TranscriptionResult(
            text=text,
            language=detected_lang,
            confidence=lang_prob,
            is_partial=is_partial,
        )


class SherpaStreamingSTTEngine:
    """True word-by-word streaming STT powered by sherpa-onnx Zipformer (ID + EN)."""

    def __init__(self, model_dir: Optional[Path] = None, language: str = "auto") -> None:
        self.model_dir = model_dir or (Path(__file__).resolve().parent / "models" / "sherpa-stt")
        self.language = language
        self.model_name = "sherpa-zipformer-id-en"
        self._recognizer = None
        self._ready = False

    def is_available_on_disk(self) -> bool:
        return (self.model_dir / "tokens.txt").exists()

    def load(self) -> None:
        import sherpa_onnx

        encoder = next(self.model_dir.glob("encoder-*.onnx"), None)
        decoder = next(self.model_dir.glob("decoder-*.onnx"), None)
        joiner = next(self.model_dir.glob("joiner-*.onnx"), None)
        tokens = self.model_dir / "tokens.txt"

        if not (encoder and decoder and joiner and tokens.exists()):
            raise FileNotFoundError(f"Missing sherpa-onnx model files in {self.model_dir}")

        self._recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
            tokens=str(tokens),
            encoder=str(encoder),
            decoder=str(decoder),
            joiner=str(joiner),
            num_threads=min(4, os.cpu_count() or 4),
            sample_rate=16000,
            feature_dim=80,
            enable_endpoint_detection=True,
            rule1_min_trailing_silence=2.0,
            rule2_min_trailing_silence=0.65,
            rule3_min_utterance_length=20.0,
        )
        self._ready = True

    @property
    def is_ready(self) -> bool:
        return self._ready

    def update_config(
        self,
        language: Optional[str] = None,
        model_name: Optional[str] = None,
    ) -> None:
        if language is not None:
            self.language = language
        if model_name is not None:
            self.model_name = model_name

    def create_stream(self):
        if not self._ready or self._recognizer is None:
            return None
        return self._recognizer.create_stream()

    def reset_stream(self, stream) -> None:
        if self._recognizer is not None and stream is not None:
            self._recognizer.reset(stream)

    def feed_pcm16(self, stream, pcm_bytes: bytes) -> tuple[str, bool]:
        if not self._ready or self._recognizer is None or stream is None:
            return "", False

        pcm_int16 = np.frombuffer(pcm_bytes, dtype=np.int16)
        if pcm_int16.size == 0:
            return "", False

        samples = pcm_int16.astype(np.float32) / 32768.0
        return self.feed_float32(stream, samples)

    def feed_float32(self, stream, samples: np.ndarray) -> tuple[str, bool]:
        if not self._ready or self._recognizer is None or stream is None or samples.size == 0:
            return "", False

        peak = float(np.max(np.abs(samples)))
        if 0.001 < peak < 0.2:
            gain = min(6.0, 0.35 / peak)
            samples = np.clip(samples * gain, -1.0, 1.0).astype(np.float32)

        stream.accept_waveform(16000, samples)
        while self._recognizer.is_ready(stream):
            self._recognizer.decode_stream(stream)

        text = self._recognizer.get_result(stream).strip()
        is_endpoint = bool(self._recognizer.is_endpoint(stream))
        return text, is_endpoint

    def flush_stream(self, stream) -> str:
        if not self._ready or self._recognizer is None or stream is None:
            return ""
        # Feed 650ms silence tail so chunk-16 Zipformer flushes all buffered words
        tail = np.zeros(int(16000 * 0.65), dtype=np.float32)
        stream.accept_waveform(16000, tail)
        while self._recognizer.is_ready(stream):
            self._recognizer.decode_stream(stream)
        return self._recognizer.get_result(stream).strip()

from __future__ import annotations

import io
import os
import re
import wave
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Iterator, Optional

import numpy as np
import soundfile as sf


MODELS_DIR = Path(__file__).resolve().parent / "models"
os.environ.setdefault("HF_HOME", str(MODELS_DIR / ".hf_cache"))

INDONESIAN_HINTS = {
    "aku", "kamu", "saya", "anda", "yang", "dan", "ini", "itu", "tidak", "nggak",
    "gak", "bisa", "ada", "untuk", "dengan", "dari", "ke", "di", "halo", "hai",
    "selamat", "terima", "kasih", "apa", "kenapa", "bagaimana", "lagi", "banget",
    "iya", "ya", "sudah", "belum", "mau", "jadi", "kalau", "karena", "atau",
}


ENGLISH_HINTS = {
    "the", "is", "are", "you", "and", "that", "this", "what", "how", "why",
    "yes", "no", "hello", "hey", "sure", "okay", "please", "thank", "thanks",
    "can", "will", "with", "for", "from", "have", "your", "here", "there",
}


def detect_text_language(text: str) -> str:
    words = set(re.findall(r"[a-zA-Z]+", text.lower()))
    if not words:
        return "id"
    id_hits = len(words & INDONESIAN_HINTS)
    en_hits = len(words & ENGLISH_HINTS)
    if en_hits >= 2 and id_hits == 0:
        return "en"
    return "id"


_SATUAN = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan"]


def _int_to_id_words(n: int) -> str:
    if n == 0:
        return "nol"
    if n < 0:
        return "minus " + _int_to_id_words(-n)
    if n < 10:
        return _SATUAN[n]
    if n == 10:
        return "sepuluh"
    if n == 11:
        return "sebelas"
    if n < 20:
        return _SATUAN[n - 10] + " belas"
    if n < 100:
        return (_SATUAN[n // 10] + " puluh " + _SATUAN[n % 10]).strip()
    if n < 200:
        return ("seratus " + _int_to_id_words(n - 100)).strip()
    if n < 1000:
        return (_SATUAN[n // 100] + " ratus " + _int_to_id_words(n % 100)).strip()
    if n < 2000:
        return ("seribu " + _int_to_id_words(n - 1000)).strip()
    if n < 1_000_000:
        return (_int_to_id_words(n // 1000) + " ribu " + (_int_to_id_words(n % 1000) if n % 1000 else "")).strip()
    if n < 1_000_000_000:
        return (_int_to_id_words(n // 1_000_000) + " juta " + (_int_to_id_words(n % 1_000_000) if n % 1_000_000 else "")).strip()
    return str(n)


def _normalize_id_numbers(text: str) -> str:
    text = re.sub(
        r"Rp\.?\s*([\d.]+)",
        lambda m: f"{_int_to_id_words(int(m.group(1).replace('.', '')))} rupiah"
        if m.group(1).replace(".", "").isdigit()
        else m.group(0),
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"(\d+)\s*%", lambda m: f"{_int_to_id_words(int(m.group(1)))} persen", text)
    text = re.sub(
        r"\b(\d{1,9})\b",
        lambda m: _int_to_id_words(int(m.group(1))),
        text,
    )
    return text


def clean_text_for_tts(text: str) -> str:
    """Strip markdown, brackets, emojis, and normalize numbers so TTS only uses punctuation for intonation."""
    # Remove [emotion] or stage-direction tags
    cleaned = re.sub(r"\[[^\]]*\]", " ", text)
    # Remove markdown formatting markers
    cleaned = re.sub(r"[`*_~#>]+", " ", cleaned)
    # Normalize Indonesian currency, percent, and numbers
    cleaned = _normalize_id_numbers(cleaned)
    # Replace pauses / dashes / colons / semicolons with natural comma pause
    cleaned = re.sub(r"[—–;:\n\r]+", ", ", cleaned)
    # Remove quotes, parentheses, slashes, and misc symbols
    cleaned = re.sub(r"[\"'“”‘’()\[\]{}/\\|@^+=<>$%*&]+", " ", cleaned)
    # Collapse ellipsis into a gentle comma pause and convert '!' to '.' so PocketTTS never reads '!' aloud
    cleaned = re.sub(r"\.{3,}", ", ", cleaned)
    cleaned = re.sub(r"\.{2}", ".", cleaned)
    cleaned = re.sub(r"!+", ".", cleaned)
    cleaned = re.sub(r"\?{2,}", "?", cleaned)
    # Keep only letters, digits, whitespace, and basic intonation (, . ?)
    cleaned = re.sub(r"[^\w\s,.?]", " ", cleaned, flags=re.UNICODE)
    cleaned = re.sub(r"\s+([,.?])", r"\1", cleaned)
    cleaned = re.sub(r"([,.?]){2,}", r"\1", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,.-")
    return cleaned


class TTSAdapter(ABC):
    name: str

    @abstractmethod
    def is_available(self) -> bool:
        ...

    @abstractmethod
    def synthesize_wav(self, text: str, voice: str, speed: float = 1.0) -> bytes:
        ...


class PiperTTSAdapter(TTSAdapter):
    name = "piper"

    PIPER_VOICES = {
        "id_ID-news_tts-medium": (
            "rhasspy/piper-voices",
            "id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx",
            "id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx.json",
        ),
        "en_US-lessac-medium": (
            "rhasspy/piper-voices",
            "en/en_US/lessac/medium/en_US-lessac-medium.onnx",
            "en/en_US/lessac/medium/en_US-lessac-medium.onnx.json",
        ),
    }

    def __init__(self) -> None:
        self._voices: dict[str, object] = {}
        self._piper_mod = None
        try:
            import piper  # type: ignore
            self._piper_mod = piper
        except Exception:
            self._piper_mod = None

    def is_available(self) -> bool:
        return self._piper_mod is not None

    def _ensure_model(self, voice_id: str) -> Path:
        piper_dir = MODELS_DIR / "piper"
        piper_dir.mkdir(parents=True, exist_ok=True)
        model_path = piper_dir / f"{voice_id}.onnx"
        config_path = piper_dir / f"{voice_id}.onnx.json"

        if model_path.exists() and config_path.exists():
            return model_path

        spec = self.PIPER_VOICES.get(voice_id)
        if spec is None:
            raise FileNotFoundError(f"Unknown Piper voice '{voice_id}' and local file not found")

        repo_id, onnx_file, json_file = spec
        from huggingface_hub import hf_hub_download

        dl_onnx = hf_hub_download(repo_id=repo_id, filename=onnx_file, local_dir=str(piper_dir / "_hf"))
        dl_json = hf_hub_download(repo_id=repo_id, filename=json_file, local_dir=str(piper_dir / "_hf"))
        Path(dl_onnx).replace(model_path)
        Path(dl_json).replace(config_path)
        return model_path

    def _get_voice(self, voice_id: str):
        if voice_id not in self._voices:
            from piper import PiperVoice  # type: ignore
            model_path = self._ensure_model(voice_id)
            self._voices[voice_id] = PiperVoice.load(str(model_path))
        return self._voices[voice_id]

    def synthesize_wav(self, text: str, voice: str, speed: float = 1.0) -> bytes:
        piper_voice = self._get_voice(voice)
        buf = io.BytesIO()
        length_scale = 1.0 / max(0.5, min(2.0, speed))
        with wave.open(buf, "wb") as wav_file:
            # piper >= 1.3 supports SynthesisConfig or synthesize_wav
            try:
                from piper.config import SynthesisConfig  # type: ignore
                syn_cfg = SynthesisConfig(length_scale=length_scale)
                piper_voice.synthesize_wav(text, wav_file, syn_config=syn_cfg)
            except Exception:
                piper_voice.synthesize(text, wav_file, length_scale=length_scale)
        return buf.getvalue()

    def synthesize_pcm_stream(
        self, text: str, voice: str, speed: float = 1.0
    ) -> tuple[int, Iterator[bytes]]:
        piper_voice = self._get_voice(voice)
        sample_rate = int(getattr(getattr(piper_voice, "config", None), "sample_rate", 22050))
        length_scale = 1.0 / max(0.5, min(2.0, speed))

        def _gen() -> Iterator[bytes]:
            try:
                from piper.config import SynthesisConfig  # type: ignore
                syn_cfg = SynthesisConfig(length_scale=length_scale)
                for chunk in piper_voice.synthesize(text, syn_config=syn_cfg):
                    pcm = getattr(chunk, "audio_int16_bytes", None)
                    if pcm:
                        yield pcm
                return
            except Exception:
                pass

            wav_bytes = self.synthesize_wav(text, voice, speed)
            with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
                raw = wf.readframes(wf.getnframes())
            step = 4096
            for i in range(0, len(raw), step):
                yield raw[i : i + step]

        return sample_rate, _gen()


class KokoroTTSAdapter(TTSAdapter):
    name = "kokoro"

    def __init__(self) -> None:
        self._kokoro = None
        self._available = False
        try:
            import kokoro_onnx  # type: ignore
            self._kokoro_cls = kokoro_onnx.Kokoro
            self._available = True
        except Exception:
            self._kokoro_cls = None
            self._available = False

    def is_available(self) -> bool:
        return self._available

    def _ensure_loaded(self):
        if self._kokoro is not None:
            return self._kokoro

        kokoro_dir = MODELS_DIR / "kokoro"
        kokoro_dir.mkdir(parents=True, exist_ok=True)
        model_path = kokoro_dir / "kokoro-v1.0.onnx"
        voices_path = kokoro_dir / "voices-v1.0.bin"

        if not model_path.exists() or not voices_path.exists():
            from huggingface_hub import hf_hub_download
            if not model_path.exists():
                hf_hub_download(
                    repo_id="thewh1teagle/kokoro-onnx",
                    filename="kokoro-v1.0.onnx",
                    local_dir=str(kokoro_dir),
                )
            if not voices_path.exists():
                hf_hub_download(
                    repo_id="thewh1teagle/kokoro-onnx",
                    filename="voices-v1.0.bin",
                    local_dir=str(kokoro_dir),
                )

        self._kokoro = self._kokoro_cls(str(model_path), str(voices_path))
        return self._kokoro

    def synthesize_wav(self, text: str, voice: str, speed: float = 1.0) -> bytes:
        kokoro = self._ensure_loaded()
        samples, sample_rate = kokoro.create(
            text,
            voice=voice or "af_heart",
            speed=max(0.5, min(2.0, speed)),
            lang="en-us",
        )
        buf = io.BytesIO()
        sf.write(buf, np.asarray(samples, dtype=np.float32), sample_rate, format="WAV")
        return buf.getvalue()

    def synthesize_pcm_stream(
        self, text: str, voice: str, speed: float = 1.0
    ) -> tuple[int, Iterator[bytes]]:
        kokoro = self._ensure_loaded()
        samples, sample_rate = kokoro.create(
            text,
            voice=voice or "af_heart",
            speed=max(0.5, min(2.0, speed)),
            lang="en-us",
        )
        arr = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
        pcm_bytes = (arr * 32767.0).astype(np.int16).tobytes()

        def _gen() -> Iterator[bytes]:
            step = 4096
            for i in range(0, len(pcm_bytes), step):
                yield pcm_bytes[i : i + step]

        return int(sample_rate), _gen()


class PocketTTSAdapter(TTSAdapter):
    name = "pocket"

    def __init__(self) -> None:
        self._model = None
        self._voice_state = None
        self._available = False
        self._config_base = MODELS_DIR / "pocket-tts" / "indonesian_6l"
        self._voice_wav = MODELS_DIR / "pocket-tts" / "nika_voice.wav"
        try:
            import pocket_tts  # noqa: F401
            self._available = (
                self._config_base.with_suffix(".yaml").exists()
                and self._voice_wav.exists()
            )
        except Exception:
            self._available = False

    def is_available(self) -> bool:
        return self._available

    @property
    def is_ready(self) -> bool:
        return self._model is not None and self._voice_state is not None

    def load(self) -> None:
        if self.is_ready or not self._available:
            return
        from pocket_tts import TTSModel

        self._model = TTSModel.load_model(
            str(self._config_base),
            temp=0.10,
            eos_threshold=-6.0,
        )
        self._voice_state = self._model.get_state_for_audio_prompt(str(self._voice_wav))

    def synthesize_wav(self, text: str, voice: str = "", speed: float = 1.0) -> bytes:
        self.load()
        assert self._model is not None and self._voice_state is not None
        audio = self._model.generate_audio(self._voice_state, text)
        samples = np.asarray(audio.detach().cpu().numpy(), dtype=np.float32)
        samples = np.clip(samples * 1.85, -0.98, 0.98)
        buf = io.BytesIO()
        sf.write(buf, samples, int(self._model.sample_rate), format="WAV")
        return buf.getvalue()

    def synthesize_pcm_stream(
        self, text: str, voice: str = "", speed: float = 1.0
    ) -> tuple[int, Iterator[bytes]]:
        self.load()
        assert self._model is not None and self._voice_state is not None
        sample_rate = int(self._model.sample_rate)

        def _gen() -> Iterator[bytes]:
            for chunk in self._model.generate_audio_stream(self._voice_state, text):
                arr = np.asarray(chunk.detach().cpu().numpy(), dtype=np.float32)
                arr = np.clip(arr * 1.85, -0.98, 0.98)
                yield (arr * 32767.0).astype(np.int16).tobytes()

        return sample_rate, _gen()


class TTSManager:
    """Manages local TTS adapters with automatic language-aware routing."""

    def __init__(self) -> None:
        self.pocket = PocketTTSAdapter()
        self.piper = PiperTTSAdapter()
        self.kokoro = KokoroTTSAdapter()

    def active_engines(self) -> list[str]:
        engines: list[str] = []
        if self.pocket.is_available():
            engines.append("pocket")
        if self.piper.is_available():
            engines.append("piper")
        if self.kokoro.is_available():
            engines.append("kokoro")
        return engines

    def synthesize(
        self,
        text: str,
        engine: str = "auto",
        voice_id: str = "id_ID-news_tts-medium",
        voice_en: str = "af_heart",
        speed: float = 1.0,
        language_hint: Optional[str] = None,
    ) -> tuple[bytes, str]:
        text = clean_text_for_tts(text)
        if not text:
            raise ValueError("No speakable text after sanitization")
        lang = language_hint if language_hint in ("id", "en") else detect_text_language(text)

        if engine == "pocket" and self.pocket.is_available():
            return self.pocket.synthesize_wav(text, voice_id, speed), "pocket"

        if engine == "kokoro" and self.kokoro.is_available():
            return self.kokoro.synthesize_wav(text, voice_en, speed), "kokoro"

        if engine == "piper" and self.piper.is_available():
            chosen_voice = voice_id if lang == "id" else "en_US-lessac-medium"
            return self.piper.synthesize_wav(text, chosen_voice, speed), "piper"

        # Auto routing: Indonesian -> Pocket Nika Clone (if ready/available) or Piper; English -> Kokoro
        if lang == "id" and self.pocket.is_available():
            return self.pocket.synthesize_wav(text, voice_id, speed), "pocket"

        if lang == "id" and self.piper.is_available():
            return self.piper.synthesize_wav(text, voice_id, speed), "piper"

        if self.kokoro.is_available():
            return self.kokoro.synthesize_wav(text, voice_en, speed), "kokoro"

        if self.piper.is_available():
            chosen_voice = voice_id if lang == "id" else "en_US-lessac-medium"
            return self.piper.synthesize_wav(text, chosen_voice, speed), "piper"

        raise RuntimeError("No local TTS engine is available")

    def synthesize_stream(
        self,
        text: str,
        engine: str = "auto",
        voice_id: str = "id_ID-news_tts-medium",
        voice_en: str = "af_heart",
        speed: float = 1.0,
        language_hint: Optional[str] = None,
    ) -> tuple[int, str, Iterator[bytes]]:
        text = clean_text_for_tts(text)
        if not text:
            raise ValueError("No speakable text after sanitization")
        lang = language_hint if language_hint in ("id", "en") else detect_text_language(text)

        if engine == "pocket" and self.pocket.is_available():
            sr, gen = self.pocket.synthesize_pcm_stream(text, voice_id, speed)
            return sr, "pocket", gen

        if engine == "kokoro" and self.kokoro.is_available():
            sr, gen = self.kokoro.synthesize_pcm_stream(text, voice_en, speed)
            return sr, "kokoro", gen

        if engine == "piper" and self.piper.is_available():
            chosen_voice = voice_id if lang == "id" else "en_US-lessac-medium"
            sr, gen = self.piper.synthesize_pcm_stream(text, chosen_voice, speed)
            return sr, "piper", gen

        if lang == "id" and self.pocket.is_available():
            sr, gen = self.pocket.synthesize_pcm_stream(text, voice_id, speed)
            return sr, "pocket", gen

        if lang == "id" and self.piper.is_available():
            sr, gen = self.piper.synthesize_pcm_stream(text, voice_id, speed)
            return sr, "piper", gen

        if self.kokoro.is_available():
            sr, gen = self.kokoro.synthesize_pcm_stream(text, voice_en, speed)
            return sr, "kokoro", gen

        if self.piper.is_available():
            chosen_voice = voice_id if lang == "id" else "en_US-lessac-medium"
            sr, gen = self.piper.synthesize_pcm_stream(text, chosen_voice, speed)
            return sr, "piper", gen

        raise RuntimeError("No local TTS engine is available")

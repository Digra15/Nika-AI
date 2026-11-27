from __future__ import annotations

import asyncio
import json
import os
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
import numpy as np
from pydantic import BaseModel

from stt_engine import FasterWhisperSTTEngine, SherpaStreamingSTTEngine
from tts_engine import TTSManager
from vad_engine import SileroVADEngine
from voice_analyzer import VoiceAnalyzer

vad_engine = SileroVADEngine(
    threshold=float(os.getenv("NIKA_VAD_THRESHOLD", "0.5")),
    min_silence_ms=int(os.getenv("NIKA_VAD_MIN_SILENCE_MS", "550")),
)
sherpa_stt = SherpaStreamingSTTEngine(
    language=os.getenv("NIKA_STT_LANGUAGE", "auto"),
)
whisper_fallback = FasterWhisperSTTEngine(
    model_name="small",
    device=os.getenv("NIKA_STT_DEVICE", "cpu"),
    compute_type=os.getenv("NIKA_STT_COMPUTE_TYPE", "int8"),
    language=os.getenv("NIKA_STT_LANGUAGE", "auto"),
)
stt_engine = sherpa_stt if sherpa_stt.is_available_on_disk() else whisper_fallback
tts_manager = TTSManager()
voice_analyzer = VoiceAnalyzer()


async def _load_models():
    try:
        print(f"[voice-sidecar] Loading Silero VAD...", flush=True)
        await asyncio.to_thread(vad_engine.load)
        print(f"[voice-sidecar] Silero VAD ready", flush=True)
    except Exception as exc:
        print(f"[voice-sidecar] Failed to load Silero VAD: {exc}", flush=True)

    try:
        print(f"[voice-sidecar] Loading STT model '{stt_engine.model_name}'...", flush=True)
        await asyncio.to_thread(stt_engine.load)
        print(f"[voice-sidecar] STT model '{stt_engine.model_name}' ready", flush=True)
        if stt_engine is sherpa_stt:
            await asyncio.to_thread(whisper_fallback.load)
            print("[voice-sidecar] Whisper fallback ready", flush=True)
    except Exception as exc:
        print(f"[voice-sidecar] Failed to load STT model '{stt_engine.model_name}': {exc}", flush=True)

    if tts_manager.pocket.is_available():
        try:
            print("[voice-sidecar] Loading Pocket TTS (Nika voice clone)...", flush=True)
            await asyncio.to_thread(tts_manager.pocket.load)
            print("[voice-sidecar] Pocket TTS ready", flush=True)
        except Exception as exc:
            print(f"[voice-sidecar] Failed to load Pocket TTS: {exc}", flush=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    asyncio.create_task(_load_models())
    yield


app = FastAPI(title="NIKA Local Voice Engine", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Sample-Rate", "X-Nika-TTS-Engine"],
)


class SynthesizeRequest(BaseModel):
    text: str
    engine: str = "auto"
    voice_id: str = "id_ID-news_tts-medium"
    voice_en: str = "af_heart"
    speed: float = 1.0
    language: Optional[str] = None


class ConfigRequest(BaseModel):
    vad_threshold: Optional[float] = None
    vad_min_silence_ms: Optional[int] = None
    stt_language: Optional[str] = None
    stt_model: Optional[str] = None


@app.get("/health")
async def health():
    engines = tts_manager.active_engines()
    return {
        "vadReady": vad_engine.is_ready,
        "sttReady": stt_engine.is_ready,
        "ttsReady": len(engines) > 0,
        "activeTtsEngines": engines,
    }


@app.post("/config")
async def update_config(req: ConfigRequest):
    vad_engine.update_config(req.vad_threshold, req.vad_min_silence_ms)
    if req.stt_language is not None:
        stt_engine.update_config(language=req.stt_language)
    if req.stt_model is not None and req.stt_model != stt_engine.model_name:
        asyncio.create_task(asyncio.to_thread(stt_engine.update_config, None, req.stt_model))
    return {"ok": True}


@app.post("/tts/synthesize")
async def synthesize(req: SynthesizeRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty")
    try:
        wav_bytes, used_engine = await asyncio.to_thread(
            tts_manager.synthesize,
            text,
            req.engine,
            req.voice_id,
            req.voice_en,
            req.speed,
            req.language,
        )
        return Response(
            content=wav_bytes,
            media_type="audio/wav",
            headers={"X-Nika-TTS-Engine": used_engine},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/tts/stream")
async def synthesize_stream(req: SynthesizeRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty")
    try:
        sample_rate, used_engine, pcm_iter = await asyncio.to_thread(
            tts_manager.synthesize_stream,
            text,
            req.engine,
            req.voice_id,
            req.voice_en,
            req.speed,
            req.language,
        )
        return StreamingResponse(
            pcm_iter,
            media_type="audio/pcm",
            headers={
                "X-Sample-Rate": str(sample_rate),
                "X-Nika-TTS-Engine": used_engine,
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class RenameSpeakerRequest(BaseModel):
    id: str
    label: str


@app.get("/speakers")
async def get_speakers():
    return {"speakers": voice_analyzer.list_speakers()}


@app.post("/speakers/rename")
async def rename_speaker(req: RenameSpeakerRequest):
    ok = voice_analyzer.rename_speaker(req.id, req.label)
    if not ok:
        raise HTTPException(status_code=404, detail="Speaker not found or invalid label")
    return {"ok": True, "speakers": voice_analyzer.list_speakers()}


@app.delete("/speakers")
async def clear_speakers():
    voice_analyzer.clear_speakers()
    return {"ok": True, "speakers": []}


@app.websocket("/ws/audio")
async def audio_stream(websocket: WebSocket):
    await websocket.accept()
    print("[voice-sidecar] WebSocket /ws/audio connected", flush=True)
    vad_engine.reset()
    last_partial_at = 0.0
    partial_task: Optional[asyncio.Task] = None
    stt_lock = asyncio.Lock()
    use_streaming_stt = isinstance(stt_engine, SherpaStreamingSTTEngine)
    sherpa_stream = stt_engine.create_stream() if use_streaming_stt else None
    last_stream_text = ""

    async def run_partial(buf):
        if stt_lock.locked():
            return
        try:
            async with stt_lock:
                tr = await asyncio.to_thread(stt_engine.transcribe, buf, True)
            if tr.text:
                await websocket.send_json(
                    {
                        "type": "partial_transcript",
                        "text": tr.text,
                        "language": tr.language,
                        "confidence": tr.confidence,
                        "isPartial": True,
                    }
                )
        except Exception:
            pass

    try:
        while True:
            message = await websocket.receive()
            if "text" in message and message["text"]:
                try:
                    cmd = json.loads(message["text"])
                    if cmd.get("type") == "config":
                        vad_engine.update_config(
                            cmd.get("vadThreshold"),
                            cmd.get("vadMinSilenceMs"),
                        )
                        if "sttLanguage" in cmd:
                            stt_engine.update_config(language=cmd["sttLanguage"])
                    elif cmd.get("type") == "reset":
                        vad_engine.reset()
                        if use_streaming_stt and sherpa_stream is not None:
                            stt_engine.reset_stream(sherpa_stream)
                            last_stream_text = ""
                except Exception:
                    pass
                continue

            pcm_bytes = message.get("bytes")
            if not pcm_bytes:
                continue

            results = vad_engine.process_pcm16(pcm_bytes)
            now = time.monotonic()

            if use_streaming_stt:
                if sherpa_stream is None and stt_engine.is_ready:
                    sherpa_stream = stt_engine.create_stream()

                vad_speech_started = False
                vad_speech_ended = False
                ended_segment = None
                for res in results:
                    if res.event == "speech_start":
                        vad_speech_started = True
                        print(f"[voice-sidecar] VAD speech_start (prob={res.speech_prob:.2f})", flush=True)
                        await websocket.send_json({"type": "vad", "active": True, "prob": res.speech_prob})
                    elif res.event == "speech_end":
                        vad_speech_ended = True
                        ended_segment = res.audio_segment
                        if ended_segment is not None and ended_segment.size > 0:
                            seg_peak = float(np.max(np.abs(ended_segment)))
                            seg_rms = float(np.sqrt(np.mean(np.square(ended_segment))))
                            print(f"[voice-sidecar] VAD speech_end (samples={ended_segment.size}, peak={seg_peak:.4f}, rms={seg_rms:.4f})", flush=True)
                        else:
                            print("[voice-sidecar] VAD speech_end", flush=True)
                        await websocket.send_json({"type": "vad", "active": False, "prob": res.speech_prob})

                if sherpa_stream is not None:
                    if vad_speech_started and vad_engine._pre_roll:
                        pre_audio = np.concatenate(vad_engine._pre_roll)
                        stt_engine.feed_float32(sherpa_stream, pre_audio)

                    text = ""
                    is_endpoint = False
                    if vad_engine._in_speech or vad_speech_started or vad_speech_ended:
                        text, is_endpoint = stt_engine.feed_pcm16(sherpa_stream, pcm_bytes)
                        if text and text != last_stream_text:
                            last_stream_text = text
                            print(f"[voice-sidecar] Sherpa partial: {text!r}", flush=True)
                            await websocket.send_json(
                                {
                                    "type": "partial_transcript",
                                    "text": text,
                                    "language": stt_engine.language if stt_engine.language != "auto" else "id",
                                    "confidence": 0.92,
                                    "isPartial": True,
                                }
                            )

                    if is_endpoint or vad_speech_ended:
                        final_text = text or last_stream_text
                        if vad_speech_ended and not is_endpoint:
                            flushed = stt_engine.flush_stream(sherpa_stream)
                            if flushed:
                                final_text = flushed
                        if not final_text and vad_speech_ended and ended_segment is not None and ended_segment.size >= 8000 and whisper_fallback.is_ready:
                            async with stt_lock:
                                wres = await asyncio.to_thread(whisper_fallback.transcribe, ended_segment, False)
                            if wres.text:
                                final_text = wres.text
                                print(f"[voice-sidecar] Whisper fallback final: {final_text!r}", flush=True)
                        if final_text:
                            voice_emotion = (
                                voice_analyzer.analyze_emotion(ended_segment)
                                if ended_segment is not None
                                else {"emotion": "neutral", "energy": 0.0, "pitchHz": 0.0}
                            )
                            speaker_info = (
                                voice_analyzer.identify_speaker(ended_segment)
                                if ended_segment is not None
                                else {"id": "spk-1", "label": "Speaker 1", "confidence": 0.5, "isNew": False}
                            )
                            print(
                                f"[voice-sidecar] Sherpa final ({speaker_info['label']}, {voice_emotion['emotion']}): {final_text!r}",
                                flush=True,
                            )
                            await websocket.send_json(
                                {
                                    "type": "final_transcript",
                                    "text": final_text,
                                    "language": stt_engine.language if stt_engine.language != "auto" else "id",
                                    "confidence": 0.95,
                                    "isPartial": False,
                                    "voiceEmotion": voice_emotion,
                                    "speaker": speaker_info,
                                }
                            )
                            stt_engine.reset_stream(sherpa_stream)
                            last_stream_text = ""
                        elif is_endpoint or vad_speech_ended:
                            print("[voice-sidecar] Sherpa speech_end but empty text", flush=True)
                            stt_engine.reset_stream(sherpa_stream)
                            last_stream_text = ""
                continue

            for res in results:
                if res.event == "speech_start":
                    print(f"[voice-sidecar] VAD speech_start (prob={res.speech_prob:.2f})", flush=True)
                    await websocket.send_json({"type": "vad", "active": True, "prob": res.speech_prob})
                elif res.event == "speech_end" and res.audio_segment is not None:
                    print(f"[voice-sidecar] VAD speech_end (samples={res.audio_segment.size})", flush=True)
                    if partial_task and not partial_task.done():
                        partial_task.cancel()
                    await websocket.send_json({"type": "vad", "active": False, "prob": res.speech_prob})
                    async with stt_lock:
                        tr = await asyncio.to_thread(stt_engine.transcribe, res.audio_segment, False)
                    print(f"[voice-sidecar] STT final: {tr.text!r} (lang={tr.language})", flush=True)
                    if tr.text:
                        await websocket.send_json(
                            {
                                "type": "final_transcript",
                                "text": tr.text,
                                "language": tr.language,
                                "confidence": tr.confidence,
                                "isPartial": False,
                            }
                        )
                elif (
                    res.is_speech
                    and stt_engine.model_name in ("tiny", "base", "small")
                    and (now - last_partial_at) > 1.6
                    and (partial_task is None or partial_task.done())
                ):
                    buf = vad_engine.get_current_buffer()
                    if buf is not None and buf.size >= 8000:
                        last_partial_at = now
                        partial_task = asyncio.create_task(run_partial(buf.copy()))
    except WebSocketDisconnect:
        if partial_task and not partial_task.done():
            partial_task.cancel()
        vad_engine.reset()


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("NIKA_VOICE_HOST", "127.0.0.1")
    port = int(os.getenv("NIKA_VOICE_PORT", "20135"))
    uvicorn.run(app, host=host, port=port, log_level="info")

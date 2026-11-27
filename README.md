# NIKA — Autonomous AI VTuber (Phase 1)

NIKA is a local-first, provider-independent Windows desktop AI VTuber built with **Electron**, **React**, **TypeScript**, **Three.js / React Three Fiber / `@pixiv/three-vrm`**, **9Router**, and **100% local speech engines**.

## Phase 1 Features
- **9Router AI Gateway** (`http://127.0.0.1:20128/v1`): OpenAI-compatible streaming client with live model discovery, dynamic model switching without restart, retries, and emotion tag parsing.
- **100% Local STT + VAD**: `Silero VAD` + `faster-whisper` (`int8` CPU) with Indonesian, English, and auto language detection, partial transcripts, and barge-in interruption.
- **100% Local TTS**: Modular `TTSManager` supporting **Piper TTS** (native Indonesian `id_ID-news_tts-medium` + English) and **Kokoro TTS** (`kokoro-onnx` natural English), with automatic language routing.
- **3D Anime Avatar**: `@pixiv/three-vrm` `.vrm` / `.glb` loader with real-time frequency-based lip-sync, eye blinking, eye tracking, head movement, and emotion-driven expressions (plus a built-in procedural 3D fallback avatar).

## Quick Start (Windows)
```powershell
.\scripts\install-windows.ps1
.\scripts\start-dev.ps1
```

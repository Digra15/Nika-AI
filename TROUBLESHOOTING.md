# NIKA Troubleshooting Guide

## 1. 9Router shows "Offline"
- Verify 9Router is running: `9router -n -p 20128`
- Test endpoint: `Invoke-RestMethod http://127.0.0.1:20128/v1/models`
- Ensure `NIKA_AI_BASE_URL=http://127.0.0.1:20128/v1` in `.env`.

## 2. Voice Engine shows "Booting..." or fails to start
- On first launch, `faster-whisper` downloads the `small` model and `silero-vad` initializes.
- Test manually:
  ```powershell
  .\voice-engine\.venv\Scripts\python.exe .\voice-engine\server.py
  ```
- Verify health: `Invoke-RestMethod http://127.0.0.1:20135/health`

## 3. Piper / Kokoro TTS first-run model download
- On the first spoken sentence in Indonesian, Piper downloads `id_ID-news_tts-medium` from Hugging Face into `voice-engine/models/piper/`.
- On the first spoken sentence in English, Kokoro downloads `kokoro-v1.0.onnx` and `voices-v1.0.bin` into `voice-engine/models/kokoro/`.
- Ensure internet access is available for the one-time model download; after that, synthesis is 100% offline.

## 4. Microphone not detected
- Check Windows Privacy Settings → Microphone → Allow desktop apps to access your microphone.
- Open **Settings** in NIKA and select your specific microphone device.

import type { ListeningMode, TranscriptEvent, VoiceConfig } from "../../shared/types/index";

export interface MouthMetrics {
  volume: number;
  aa: number;
  ih: number;
  ou: number;
  ee: number;
  oh: number;
}

export interface AudioPipelineCallbacks {
  onVadChange: (active: boolean) => void;
  onPartialTranscript: (ev: TranscriptEvent) => void;
  onFinalTranscript: (ev: TranscriptEvent) => void;
  onInterrupt: () => void;
  onSpeakingChange: (speaking: boolean) => void;
  onSocketStatus: (connected: boolean) => void;
  onMicStatus?: (active: boolean, error?: string) => void;
}

export class AudioPipeline {
  private ws: WebSocket | null = null;
  private micContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private processorNode: ScriptProcessorNode | null = null;

  private playbackContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private audioQueue: AudioBuffer[] = [];
  private activeSource: AudioBufferSourceNode | null = null;
  private scheduledSources = new Set<AudioBufferSourceNode>();
  private nextScheduleTime = 0;
  private isPlaying = false;
  private lastSpokenEndedAt = 0;

  private listeningMode: ListeningMode = "auto";
  private wakeWord = "nika";
  private pttPressed = false;
  private reconnectTimer: number | null = null;
  private bargeInTimer: number | null = null;
  private disposed = false;
  private resampleCarry: Float32Array = new Float32Array(0);

  constructor(private readonly callbacks: AudioPipelineCallbacks) {}

  async start(config: VoiceConfig): Promise<void> {
    this.disposed = false;
    this.listeningMode = config.listeningMode;
    this.wakeWord = config.wakeWord.toLowerCase().trim();
    this.ensurePlaybackContext();
    this.connectWebSocket(config);
    await this.startMicrophone(config.inputDeviceId);
  }

  updateConfig(config: VoiceConfig): void {
    this.listeningMode = config.listeningMode;
    this.wakeWord = config.wakeWord.toLowerCase().trim();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "config",
          vadThreshold: config.vadThreshold,
          vadMinSilenceMs: config.vadMinSilenceMs,
          sttLanguage: config.sttLanguage
        })
      );
    }
  }

  setPushToTalk(active: boolean): void {
    this.pttPressed = active;
  }

  async restartMicrophone(inputDeviceId: string): Promise<void> {
    this.stopMicrophone();
    await this.startMicrophone(inputDeviceId);
  }

  async ensureActive(config: VoiceConfig): Promise<void> {
    if (
      !this.ws ||
      (this.ws.readyState !== WebSocket.OPEN && this.ws.readyState !== WebSocket.CONNECTING)
    ) {
      this.connectWebSocket(config);
    }
    if (this.micContext && this.micContext.state === "suspended") {
      await this.micContext.resume();
    }
    if (!this.micStream) {
      await this.startMicrophone(config.inputDeviceId);
    }
  }

  isSocketOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private ensurePlaybackContext(): AudioContext {
    if (!this.playbackContext) {
      this.playbackContext = new AudioContext();
      this.analyser = this.playbackContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.35;
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      const outputGain = this.playbackContext.createGain();
      outputGain.gain.value = 1.5;
      this.analyser.connect(outputGain);
      outputGain.connect(this.playbackContext.destination);
    }
    if (this.playbackContext.state === "suspended") {
      void this.playbackContext.resume();
    }
    return this.playbackContext;
  }

  private connectWebSocket(config: VoiceConfig): void {
    if (this.disposed) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    const url = `ws://${config.host}:${config.port}/ws/audio`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      console.info("[AudioPipeline] WebSocket /ws/audio connected");
      this.callbacks.onSocketStatus(true);
      ws.send(
        JSON.stringify({
          type: "config",
          vadThreshold: config.vadThreshold,
          vadMinSilenceMs: config.vadMinSilenceMs,
          sttLanguage: config.sttLanguage
        })
      );
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const msg = JSON.parse(event.data) as {
          type: string;
          active?: boolean;
          text?: string;
          language?: string;
          confidence?: number;
        };

        if (msg.type === "vad") {
          const active = Boolean(msg.active);
          this.callbacks.onVadChange(active);
          if (active && this.isPlaying && this.listeningMode !== "muted") {
            // Require 450ms sustained voice before interrupting TTS (prevents speaker echo/clicks)
            if (this.bargeInTimer === null) {
              this.bargeInTimer = window.setTimeout(() => {
                this.bargeInTimer = null;
                if (this.isPlaying && this.listeningMode !== "muted") {
                  this.stopPlayback();
                  this.callbacks.onInterrupt();
                }
              }, 450);
            }
          } else if (!active && this.bargeInTimer !== null) {
            clearTimeout(this.bargeInTimer);
            this.bargeInTimer = null;
          }
        } else if (msg.type === "partial_transcript" && msg.text) {
          if (this.isPlaying && this.listeningMode !== "muted" && msg.text.trim().length >= 3) {
            if (this.bargeInTimer !== null) {
              clearTimeout(this.bargeInTimer);
              this.bargeInTimer = null;
            }
            this.stopPlayback();
            this.callbacks.onInterrupt();
          }
          this.callbacks.onPartialTranscript({
            text: msg.text,
            language: msg.language || "id",
            confidence: msg.confidence ?? 0.8,
            isPartial: true,
            timestamp: Date.now()
          });
        } else if (msg.type === "final_transcript" && msg.text) {
          const clean = msg.text.trim();
          if (!clean) return;
          if (
            this.listeningMode === "wake-word" &&
            this.wakeWord &&
            !clean.toLowerCase().includes(this.wakeWord)
          ) {
            return;
          }
          this.callbacks.onFinalTranscript({
            text: clean,
            language: msg.language || "id",
            confidence: msg.confidence ?? 0.9,
            isPartial: false,
            timestamp: Date.now()
          });
        }
      } catch {
        // Ignore malformed frame
      }
    };

    ws.onclose = () => {
      this.callbacks.onSocketStatus(false);
      if (!this.disposed) {
        this.reconnectTimer = window.setTimeout(() => {
          this.connectWebSocket(config);
        }, 2500);
      }
    };

    ws.onerror = () => {
      this.callbacks.onSocketStatus(false);
    };

    this.ws = ws;
  }

  private downsampleWithCarry(input: Float32Array, inputSampleRate: number): Int16Array {
    if (inputSampleRate === 16000) {
      const out = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return out;
    }

    const combined = new Float32Array(this.resampleCarry.length + input.length);
    combined.set(this.resampleCarry, 0);
    combined.set(input, this.resampleCarry.length);

    const ratio = inputSampleRate / 16000;
    const outputLength = Math.floor(combined.length / ratio);
    const consumed = Math.floor(outputLength * ratio);
    this.resampleCarry = combined.slice(consumed);

    const output = new Int16Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(combined.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      const count = Math.max(1, end - start);
      for (let j = start; j < end; j++) {
        sum += combined[j];
      }
      const sample = Math.max(-1, Math.min(1, sum / count));
      output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    return output;
  }

  private async startMicrophone(deviceId: string): Promise<void> {
    try {
      const baseAudio: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      };

      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio:
            deviceId && deviceId !== "default"
              ? { ...baseAudio, deviceId: { exact: deviceId } }
              : baseAudio
        });
      } catch (err) {
        if (deviceId && deviceId !== "default") {
          this.micStream = await navigator.mediaDevices.getUserMedia({ audio: baseAudio });
        } else {
          throw err;
        }
      }

      this.micContext = new AudioContext();
      if (this.micContext.state === "suspended") {
        await this.micContext.resume();
      }
      const source = this.micContext.createMediaStreamSource(this.micStream);
      this.processorNode = this.micContext.createScriptProcessor(2048, 1, 1);
      const silentGain = this.micContext.createGain();
      silentGain.gain.value = 0;

      this.processorNode.onaudioprocess = (event) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        if (this.listeningMode === "muted") return;
        if (this.listeningMode === "push-to-talk" && !this.pttPressed) return;

        const input = event.inputBuffer.getChannelData(0);
        const pcm16 = this.downsampleWithCarry(input, this.micContext?.sampleRate ?? 48000);
        if (pcm16.length > 0) {
          this.ws.send(pcm16.buffer);
        }
      };

      source.connect(this.processorNode);
      this.processorNode.connect(silentGain);
      silentGain.connect(this.micContext.destination);
      this.callbacks.onMicStatus?.(true);
    } catch (err) {
      this.callbacks.onMicStatus?.(false, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private stopMicrophone(): void {
    this.resampleCarry = new Float32Array(0);
    this.processorNode?.disconnect();
    this.processorNode = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    void this.micContext?.close();
    this.micContext = null;
    this.callbacks.onMicStatus?.(false);
  }

  async enqueueWavBase64(base64Audio: string): Promise<void> {
    const ctx = this.ensurePlaybackContext();
    const binary = atob(base64Audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
    this.audioQueue.push(audioBuffer);
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  private playNext(): void {
    const next = this.audioQueue.shift();
    if (!next || !this.playbackContext || !this.analyser) {
      this.isPlaying = false;
      this.callbacks.onSpeakingChange(false);
      return;
    }

    this.isPlaying = true;
    this.callbacks.onSpeakingChange(true);

    const source = this.playbackContext.createBufferSource();
    source.buffer = next;
    source.connect(this.analyser);
    source.onended = () => {
      if (this.activeSource === source) {
        this.activeSource = null;
        this.playNext();
      }
    };

    this.activeSource = source;
    source.start();
  }

  async streamSpeech(params: {
    text: string;
    config: VoiceConfig;
    language?: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const ctx = this.ensurePlaybackContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    if (!this.analyser) return;

    const nowMs = Date.now();
    const isContinuingUtterance = nowMs - this.lastSpokenEndedAt < 2500;
    const breathEnabled = params.config.breathAudioEnabled ?? true;
    const breathVol = params.config.breathVolume ?? 0.18;
    if (isContinuingUtterance && breathEnabled && breathVol > 0.01) {
      this.playSoftBreathInhale(ctx, breathVol);
    }

    const url = `http://${params.config.host}:${params.config.port}/tts/stream`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: params.signal,
      body: JSON.stringify({
        text: params.text,
        engine: params.config.ttsEngine,
        voice_id: params.config.ttsVoiceId,
        voice_en: params.config.ttsVoiceEn,
        speed: params.config.ttsSpeed,
        language: params.language
      })
    });

    if (!res.ok || !res.body) {
      throw new Error(`TTS stream failed (${res.status})`);
    }

    const sampleRate = Number(res.headers.get("X-Sample-Rate") || 22050);
    const reader = res.body.getReader();
    let leftoverByte: number | null = null;
    let sentenceEndTime = 0;

    while (true) {
      if (params.signal?.aborted) {
        await reader.cancel();
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      let bytes = value;
      if (leftoverByte !== null) {
        const merged = new Uint8Array(bytes.length + 1);
        merged[0] = leftoverByte;
        merged.set(bytes, 1);
        bytes = merged;
        leftoverByte = null;
      }
      if (bytes.length % 2 === 1) {
        leftoverByte = bytes[bytes.length - 1];
        bytes = bytes.subarray(0, bytes.length - 1);
      }
      if (bytes.length < 2) continue;

      const sampleCount = bytes.length / 2;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const audioBuf = ctx.createBuffer(1, sampleCount, sampleRate);
      const channel = audioBuf.getChannelData(0);
      for (let i = 0; i < sampleCount; i++) {
        channel[i] = view.getInt16(i * 2, true) / 32768;
      }

      const source = ctx.createBufferSource();
      source.buffer = audioBuf;
      source.connect(this.analyser);

      const minStart = ctx.currentTime + 0.04;
      const startAt = this.nextScheduleTime > minStart ? this.nextScheduleTime : minStart;
      this.nextScheduleTime = startAt + audioBuf.duration;
      sentenceEndTime = this.nextScheduleTime;

      this.scheduledSources.add(source);
      this.isPlaying = true;
      this.callbacks.onSpeakingChange(true);

      source.onended = () => {
        this.scheduledSources.delete(source);
        if (this.scheduledSources.size === 0 && !this.activeSource && this.audioQueue.length === 0) {
          this.isPlaying = false;
          this.nextScheduleTime = 0;
          this.callbacks.onSpeakingChange(false);
        }
      };

      source.start(startAt);
    }

    // Wait until this sentence finishes playing + configured natural breath pause
    // so the next queued sentence never chases or interrupts the current one.
    const pauseMs = Math.max(80, Math.min(2000, params.config.sentencePauseMs ?? 480));
    if (sentenceEndTime > ctx.currentTime && !params.signal?.aborted) {
      const remainingMs = Math.max(0, (sentenceEndTime - ctx.currentTime) * 1000) + pauseMs;
      await new Promise<void>((resolve) => {
        if (params.signal?.aborted) {
          resolve();
          return;
        }
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = window.setTimeout(() => {
          params.signal?.removeEventListener("abort", onAbort);
          resolve();
        }, remainingMs);
        params.signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    if (!params.signal?.aborted) {
      this.lastSpokenEndedAt = Date.now();
    }
  }

  private playSoftBreathInhale(ctx: AudioContext, volume: number): void {
    if (!this.analyser) return;
    const durationSec = 0.18;
    const sampleCount = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    let prev = 0;
    for (let i = 0; i < sampleCount; i++) {
      const t = i / sampleCount;
      const env = Math.pow(Math.sin(Math.PI * t), 1.6);
      const white = Math.random() * 2 - 1;
      prev = (prev + 0.04 * white) / 1.04;
      data[i] = (prev * 2.2 + white * 0.25) * env;
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 950;
    filter.Q.value = 1.4;

    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(0.5, volume)) * 0.22;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.analyser);
    src.start(ctx.currentTime + 0.02);
  }

  stopPlayback(): void {
    this.audioQueue = [];
    this.nextScheduleTime = 0;
    for (const src of this.scheduledSources) {
      try {
        src.stop();
      } catch {
        // Already stopped
      }
    }
    this.scheduledSources.clear();
    if (this.activeSource) {
      try {
        this.activeSource.stop();
      } catch {
        // Already stopped
      }
      this.activeSource = null;
    }
    this.isPlaying = false;
    this.callbacks.onSpeakingChange(false);
  }

  getMouthMetrics(): MouthMetrics {
    if (!this.isPlaying || !this.analyser || !this.freqData) {
      return { volume: 0, aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    }

    this.analyser.getByteFrequencyData(this.freqData);
    const len = this.freqData.length;
    let total = 0;
    let low = 0;
    let mid = 0;
    let high = 0;

    for (let i = 0; i < len; i++) {
      const v = this.freqData[i] / 255;
      total += v;
      if (i < len * 0.2) low += v;
      else if (i < len * 0.55) mid += v;
      else high += v;
    }

    const volume = Math.min(1, (total / len) * 3.2);
    const lowNorm = Math.min(1, (low / (len * 0.2)) * 2.4);
    const midNorm = Math.min(1, (mid / (len * 0.35)) * 2.8);
    const highNorm = Math.min(1, (high / (len * 0.45)) * 3.0);

    return {
      volume,
      aa: Math.min(1, midNorm * 0.9 + lowNorm * 0.3),
      ih: Math.min(1, highNorm * 0.7),
      ou: Math.min(1, lowNorm * 0.8),
      ee: Math.min(1, (midNorm + highNorm) * 0.45),
      oh: Math.min(1, (lowNorm + midNorm) * 0.4)
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
    }
    this.stopPlayback();
    this.stopMicrophone();
    this.ws?.close();
    this.ws = null;
    void this.playbackContext?.close();
    this.playbackContext = null;
  }
}

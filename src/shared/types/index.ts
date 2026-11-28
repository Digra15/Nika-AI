export type EmotionType =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "thinking"
  | "laugh";

export type AvatarActivityState =
  | "idle"
  | "listening"
  | "thinking"
  | "talking"
  | "laughing";

export type ListeningMode = "auto" | "push-to-talk" | "wake-word" | "muted";

export type TTSEngineType = "auto" | "pocket" | "piper" | "kokoro";
export type STTEngineType = "faster-whisper";

export interface AIModelCapabilities {
  vision?: boolean;
  tools?: boolean;
  reasoning?: boolean;
  contextWindow?: number;
  maxOutput?: number;
}

export interface AIModelInfo {
  id: string;
  ownedBy: string;
  capabilities?: AIModelCapabilities;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  emotion?: EmotionType;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort: "low" | "medium" | "high" | "none";
  systemPrompt: string;
}

export interface VoiceConfig {
  host: string;
  port: number;
  sttEngine: STTEngineType;
  sttModel: string;
  sttLanguage: "auto" | "id" | "en";
  ttsEngine: TTSEngineType;
  ttsVoiceId: string;
  ttsVoiceEn: string;
  ttsSpeed: number;
  sentencePauseMs: number;
  breathAudioEnabled: boolean;
  breathVolume: number;
  bargeInEnabled: boolean;
  ownerOnlyMode: boolean;
  vadThreshold: number;
  vadMinSilenceMs: number;
  listeningMode: ListeningMode;
  wakeWord: string;
  inputDeviceId: string;
  outputDeviceId: string;
}

export type PersonaPresetId =
  | "cheerful-vtuber"
  | "tsundere"
  | "calm-caring"
  | "genki"
  | "custom";

export interface PersonaConfig {
  name: string;
  preset: PersonaPresetId;
  userCallName: string;
  personality: string;
  speakingStyle: string;
  backstory: string;
  customInstructions: string;
}

export type MoodType =
  | "cheerful"
  | "calm"
  | "playful"
  | "curious"
  | "affectionate"
  | "melancholy"
  | "annoyed";

export interface NikaMindState {
  mood: MoodType;
  happiness: number;
  affection: number;
  energy: number;
  trust: number;
  interactionCount: number;
  lastInteractionAt: number;
}

export type MemoryCategory = "fact" | "preference" | "feeling" | "event";

export interface MemoryItem {
  id: string;
  content: string;
  category: MemoryCategory;
  importance: number;
  createdAt: number;
  lastAccessedAt: number;
}

export interface MemorySnapshot {
  mind: NikaMindState;
  memories: MemoryItem[];
}

export interface AppSettings {
  ai: AIConfig;
  persona: PersonaConfig;
  voice: VoiceConfig;
  ui: {
    alwaysOnTop: boolean;
    avatarPath: string;
    language: "id" | "en";
    cameraDeviceId?: string;
    cameraResolution?: "auto" | "320x240" | "640x360" | "640x480" | "1280x720";
  };
}

export interface VoiceEmotionInfo {
  emotion: "neutral" | "calm" | "excited" | "angry" | "sad";
  energy: number;
  pitchHz: number;
}

export interface SpeakerIdentity {
  id: string;
  label: string;
  confidence: number;
  isNew: boolean;
}

export interface TranscriptEvent {
  text: string;
  language: string;
  isPartial: boolean;
  confidence: number;
  timestamp: number;
  voiceEmotion?: VoiceEmotionInfo;
  speaker?: SpeakerIdentity;
}

export interface VoiceSidecarStatus {
  connected: boolean;
  vadReady: boolean;
  sttReady: boolean;
  ttsReady: boolean;
  activeTtsEngines: string[];
  error?: string;
}

export interface SystemReadiness {
  configReady: boolean;
  memoryReady: boolean;
  toolsCount: number;
  agentBrowserReady: boolean;
  routerOnline: boolean;
  voice: VoiceSidecarStatus;
}

export interface PipelineState {
  avatarState: AvatarActivityState;
  emotion: EmotionType;
  vadActive: boolean;
  isSpeaking: boolean;
  isGenerating: boolean;
  lastError?: string;
}

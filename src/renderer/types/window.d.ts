/// <reference types="vite/client" />

import type {
  AIModelInfo,
  AppSettings,
  ChatMessage,
  EmotionType,
  MemoryCategory,
  MemoryItem,
  MemorySnapshot,
  NikaMindState,
  SystemReadiness,
  VoiceSidecarStatus
} from "../../shared/types/index";

export type ChatStreamEvent =
  | { requestId: string; type: "token"; delta: string }
  | { requestId: string; type: "emotion"; emotion: EmotionType }
  | {
      requestId: string;
      type: "transcript_corrected";
      rawText: string;
      correctedText: string;
    }
  | { requestId: string; type: "sentence"; sentence: string }
  | { requestId: string; type: "mind"; mind: NikaMindState }
  | { requestId: string; type: "gesture"; gesture: string }
  | {
      requestId: string;
      type: "plan";
      plan: { goal: string; doneCount: number; totalCount: number } | null;
    }
  | { requestId: string; type: "tool"; tool: { name: string; status: "running" | "done" } }
  | { requestId: string; type: "done"; message: ChatMessage };

export interface NikaAPI {
  getSettings: () => Promise<AppSettings>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  checkRouterHealth: () => Promise<boolean>;
  listModels: () => Promise<AIModelInfo[]>;
  checkVoiceHealth: () => Promise<VoiceSidecarStatus>;
  checkSystemReadiness: () => Promise<SystemReadiness>;
  sendChatMessage: (payload: {
    text: string;
    requestId: string;
    isVoiceInput?: boolean;
    confidence?: number;
    voiceEmotion?: string;
    speakerLabel?: string;
  }) => Promise<ChatMessage | null>;
  abortChat: () => Promise<boolean>;
  clearHistory: () => Promise<boolean>;
  getMemorySnapshot: () => Promise<MemorySnapshot>;
  addMemory: (payload: {
    content: string;
    category?: MemoryCategory;
    importance?: number;
  }) => Promise<MemoryItem | null>;
  deleteMemory: (id: string) => Promise<boolean>;
  clearMemories: () => Promise<boolean>;
  resetMind: () => Promise<NikaMindState>;
  synthesizeSpeech: (payload: {
    text: string;
    language?: string;
  }) => Promise<{ audioBase64: string; engine: string }>;
  pickAvatarFile: () => Promise<{
    filePath: string;
    fileName: string;
    base64: string;
  } | null>;
  toggleAlwaysOnTop: () => Promise<boolean>;
  updateCameraFrame: (base64: string | null) => Promise<boolean>;
  setLiveVision: (state: { camera?: boolean; screen?: boolean }) => Promise<boolean>;
  startNativeCamera: (opts?: {
    deviceName?: string;
    resolution?: "auto" | "320x240" | "640x360" | "640x480" | "1280x720";
  }) => Promise<{ deviceName: string; size: string; fps: number }>;
  stopNativeCamera: () => Promise<boolean>;
  onNativeCameraFrame: (cb: (base64: string) => void) => () => void;
  onNativeCameraError: (cb: (reason: string) => void) => () => void;
  onChatStream: (cb: (event: ChatStreamEvent) => void) => () => void;
}

declare global {
  interface Window {
    nikaAPI: NikaAPI;
  }
}

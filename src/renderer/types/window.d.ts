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
  | { requestId: string; type: "sentence"; sentence: string }
  | { requestId: string; type: "mind"; mind: NikaMindState }
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
  sendChatMessage: (payload: { text: string; requestId: string }) => Promise<ChatMessage>;
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
  onChatStream: (cb: (event: ChatStreamEvent) => void) => () => void;
}

declare global {
  interface Window {
    nikaAPI: NikaAPI;
  }
}

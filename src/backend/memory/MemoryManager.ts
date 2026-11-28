import fs from "fs";
import path from "path";
import type {
  ChatMessage,
  EmotionType,
  MemoryCategory,
  MemoryItem,
  MemorySnapshot,
  MoodType,
  NikaMindState,
  PersonaConfig
} from "../../shared/types/index.js";
import { HUMANIZER_PROMPT_RULES } from "../ai/humanizer/ResponseHumanizer.js";
import type { ContextAnalysis } from "../ai/brain/NikaBrain.js";

interface PersistedMemoryData {
  mind: NikaMindState;
  memories: MemoryItem[];
  recentHistory: ChatMessage[];
}

function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(val)));
}

function createDefaultMind(): NikaMindState {
  return {
    mood: "cheerful",
    happiness: 70,
    affection: 55,
    energy: 75,
    trust: 60,
    interactionCount: 0,
    lastInteractionAt: Date.now()
  };
}

const POSITIVE_WORDS = [
  "makasih",
  "terima kasih",
  "thanks",
  "thank you",
  "sayang",
  "suka kamu",
  "lucu",
  "keren",
  "hebat",
  "pintar",
  "baik",
  "imut",
  "cute",
  "love",
  "awesome",
  "good job",
  "mantap",
  "semangat"
];

const NEGATIVE_WORDS = [
  "bodoh",
  "bego",
  "tolol",
  "jelek",
  "benci",
  "menyebalkan",
  "berisik",
  "diam",
  "stupid",
  "hate",
  "annoying",
  "shut up",
  "useless"
];

const EMPATHY_WORDS = [
  "capek",
  "lelah",
  "sedih",
  "stres",
  "pusing",
  "galau",
  "kesepian",
  "tired",
  "sad",
  "lonely",
  "stressed"
];

export class MemoryManager {
  private readonly filePath: string;
  private data: PersistedMemoryData;
  private readonly maxMemories = 120;
  private readonly maxRecentHistory = 30;

  constructor(userDataDir?: string) {
    const baseDir = userDataDir || path.join(process.cwd(), ".nika-data");
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    this.filePath = path.join(baseDir, "nika-memory.json");
    this.data = this.load();
    this.applyTimeDecay();
  }

  private load(): PersistedMemoryData {
    if (!fs.existsSync(this.filePath)) {
      return {
        mind: createDefaultMind(),
        memories: [],
        recentHistory: []
      };
    }
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<PersistedMemoryData>;
      return {
        mind: { ...createDefaultMind(), ...(parsed.mind ?? {}) },
        memories: Array.isArray(parsed.memories) ? parsed.memories : [],
        recentHistory: Array.isArray(parsed.recentHistory) ? parsed.recentHistory : []
      };
    } catch {
      return {
        mind: createDefaultMind(),
        memories: [],
        recentHistory: []
      };
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  private applyTimeDecay(): void {
    const hoursElapsed = Math.max(
      0,
      (Date.now() - this.data.mind.lastInteractionAt) / (1000 * 60 * 60)
    );
    if (hoursElapsed < 1) return;
    const factor = Math.min(1, hoursElapsed / 24);
    this.data.mind.happiness = clamp(
      this.data.mind.happiness + (68 - this.data.mind.happiness) * factor * 0.5
    );
    this.data.mind.energy = clamp(
      this.data.mind.energy + (72 - this.data.mind.energy) * factor * 0.6
    );
    this.data.mind.trust = clamp(
      this.data.mind.trust + (60 - this.data.mind.trust) * factor * 0.25
    );
    this.data.mind.mood = this.deriveMood(this.data.mind);
  }

  getSnapshot(): MemorySnapshot {
    return {
      mind: { ...this.data.mind },
      memories: this.data.memories.map((m) => ({ ...m }))
    };
  }

  getRecentHistory(): ChatMessage[] {
    return this.data.recentHistory.map((m) => ({ ...m }));
  }

  appendHistory(msg: ChatMessage): void {
    this.data.recentHistory.push(msg);
    if (this.data.recentHistory.length > this.maxRecentHistory) {
      this.data.recentHistory = this.data.recentHistory.slice(-this.maxRecentHistory);
    }
    this.save();
  }

  clearHistory(): void {
    this.data.recentHistory = [];
    this.save();
  }

  addMemory(
    content: string,
    category: MemoryCategory = "fact",
    importance = 3
  ): MemoryItem | null {
    const clean = content.replace(/\s+/g, " ").trim();
    if (clean.length < 3) return null;

    const normalized = clean.toLowerCase();
    const existing = this.data.memories.find(
      (m) =>
        m.content.toLowerCase() === normalized ||
        (normalized.length > 10 && m.content.toLowerCase().includes(normalized))
    );

    const now = Date.now();
    if (existing) {
      existing.lastAccessedAt = now;
      existing.importance = Math.max(existing.importance, clamp(importance, 1, 5));
      this.save();
      return { ...existing };
    }

    const item: MemoryItem = {
      id: `mem-${now}-${Math.random().toString(36).slice(2, 7)}`,
      content: clean,
      category,
      importance: clamp(importance, 1, 5),
      createdAt: now,
      lastAccessedAt: now
    };

    this.data.memories.unshift(item);
    if (this.data.memories.length > this.maxMemories) {
      this.data.memories.sort(
        (a, b) => b.importance * 1e12 + b.lastAccessedAt - (a.importance * 1e12 + a.lastAccessedAt)
      );
      this.data.memories = this.data.memories.slice(0, this.maxMemories);
    }
    this.save();
    return { ...item };
  }

  deleteMemory(id: string): boolean {
    const before = this.data.memories.length;
    this.data.memories = this.data.memories.filter((m) => m.id !== id);
    if (this.data.memories.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  clearMemories(): void {
    this.data.memories = [];
    this.save();
  }

  resetMind(): NikaMindState {
    this.data.mind = createDefaultMind();
    this.save();
    return { ...this.data.mind };
  }

  adjustMindExplicit(params: {
    mood?: MoodType;
    happinessDelta?: number;
    affectionDelta?: number;
  }): NikaMindState {
    const mind = this.data.mind;
    if (params.happinessDelta) {
      mind.happiness = clamp(mind.happiness + params.happinessDelta);
    }
    if (params.affectionDelta) {
      mind.affection = clamp(mind.affection + params.affectionDelta);
    }
    if (params.mood) {
      mind.mood = params.mood;
    }
    mind.lastInteractionAt = Date.now();
    this.save();
    return { ...mind };
  }

  extractAndStoreFromUserMessage(userText: string): MemoryItem[] {
    const text = userText.trim();
    if (!text) return [];
    const added: MemoryItem[] = [];

    const pushIf = (content: string, cat: MemoryCategory, imp: number) => {
      const item = this.addMemory(content, cat, imp);
      if (item) added.push(item);
    };

    const explicitMatch = text.match(
      /(?:ingat(?:\s+ya)?|jangan\s+lupa|catat|remember(?:\s+that)?)\s+([^.!?\n]{4,140})/i
    );
    if (explicitMatch?.[1]) {
      pushIf(explicitMatch[1].trim(), "fact", 5);
    }

    const nameMatch = text.match(
      /(?:nama(?:ku| saya)\s+(?:adalah\s+)?|panggil\s+aku\s+|my\s+name\s+is\s+|call\s+me\s+)([a-zA-Z0-9 _.-]{2,32})/i
    );
    if (nameMatch?.[1]) {
      pushIf(`Nama user adalah ${nameMatch[1].trim()}`, "fact", 5);
    }

    const likeMatch = text.match(
      /(?:aku|saya|gue|i)\s+(?:suka|senang|hobi|favorit(?:ku)?|love|like|enjoy)\s+([^.!?\n]{3,90})/i
    );
    if (likeMatch?.[1] && !/\b(?:kamu|you|nika)\b/i.test(likeMatch[1])) {
      pushIf(`User suka ${likeMatch[1].trim()}`, "preference", 4);
    }

    const dislikeMatch = text.match(
      /(?:aku|saya|gue|i)\s+(?:tidak\s+suka|ga\s+suka|gak\s+suka|benci|hate|dislike)\s+([^.!?\n]{3,90})/i
    );
    if (dislikeMatch?.[1] && !/\b(?:kamu|you|nika)\b/i.test(dislikeMatch[1])) {
      pushIf(`User tidak suka ${dislikeMatch[1].trim()}`, "preference", 4);
    }

    const roleMatch = text.match(
      /(?:aku|saya|gue)\s+((?:kerja|kuliah|sekolah|tinggal)\s+(?:di|sebagai)\s+[^.!?\n]{3,90})/i
    );
    if (roleMatch?.[1]) {
      pushIf(`User ${roleMatch[1].trim()}`, "fact", 4);
    }

    return added;
  }

  updateMindFromUserMessage(userText: string, voiceEmotion?: string): NikaMindState {
    this.applyTimeDecay();
    const lower = userText.toLowerCase();
    const mind = this.data.mind;

    const posHits = POSITIVE_WORDS.filter((w) => lower.includes(w)).length;
    const negHits = NEGATIVE_WORDS.filter((w) => lower.includes(w)).length;
    const empathyHits = EMPATHY_WORDS.filter((w) => lower.includes(w)).length;
    const isQuestion = lower.includes("?") || /\b(kenapa|mengapa|bagaimana|apa itu|why|how)\b/.test(lower);

    if (voiceEmotion === "excited") {
      mind.happiness = clamp(mind.happiness + 4);
      mind.energy = clamp(mind.energy + 4);
    } else if (voiceEmotion === "angry") {
      mind.happiness = clamp(mind.happiness - 5);
      mind.trust = clamp(mind.trust - 3);
    } else if (voiceEmotion === "sad") {
      mind.affection = clamp(mind.affection + 2);
      mind.energy = clamp(mind.energy - 2);
    }

    if (posHits > 0) {
      mind.happiness = clamp(mind.happiness + Math.min(12, posHits * 5));
      mind.affection = clamp(mind.affection + Math.min(8, posHits * 3));
      mind.trust = clamp(mind.trust + Math.min(6, posHits * 2));
      mind.energy = clamp(mind.energy + 3);
    }

    if (negHits > 0) {
      mind.happiness = clamp(mind.happiness - Math.min(18, negHits * 8));
      mind.affection = clamp(mind.affection - Math.min(10, negHits * 4));
      mind.trust = clamp(mind.trust - Math.min(12, negHits * 5));
    }

    if (empathyHits > 0) {
      mind.affection = clamp(mind.affection + 2);
      mind.energy = clamp(mind.energy - 2);
    }

    if (isQuestion) {
      mind.energy = clamp(mind.energy + 2);
    }

    mind.interactionCount += 1;
    mind.lastInteractionAt = Date.now();
    mind.mood = this.deriveMood(mind, undefined, isQuestion, empathyHits > 0);
    this.save();
    return { ...mind };
  }

  updateMindFromAssistantEmotion(emotion: EmotionType): NikaMindState {
    const mind = this.data.mind;
    if (emotion === "happy" || emotion === "laugh") {
      mind.happiness = clamp(mind.happiness + 3);
      mind.energy = clamp(mind.energy + 2);
    } else if (emotion === "sad") {
      mind.happiness = clamp(mind.happiness - 4);
      mind.energy = clamp(mind.energy - 3);
    } else if (emotion === "angry") {
      mind.happiness = clamp(mind.happiness - 5);
      mind.trust = clamp(mind.trust - 2);
    }
    mind.lastInteractionAt = Date.now();
    mind.mood = this.deriveMood(mind, emotion);
    this.save();
    return { ...mind };
  }

  private deriveMood(
    mind: NikaMindState,
    lastEmotion?: EmotionType,
    isQuestion = false,
    userSad = false
  ): MoodType {
    if (mind.happiness <= 32 && mind.trust <= 42) return "annoyed";
    if (mind.happiness <= 38 || (userSad && mind.happiness < 55)) return "melancholy";
    if (mind.affection >= 75 && mind.happiness >= 65) return "affectionate";
    if (lastEmotion === "laugh" || (mind.happiness >= 78 && mind.energy >= 65)) return "playful";
    if (isQuestion || lastEmotion === "thinking" || lastEmotion === "surprised") return "curious";
    if (mind.happiness >= 58) return "cheerful";
    return "calm";
  }

  selectRelevantMemories(query: string, limit = 8): MemoryItem[] {
    if (this.data.memories.length === 0) return [];
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3);

    const scored = this.data.memories.map((m) => {
      const lower = m.content.toLowerCase();
      let score = m.importance * 2;
      for (const tok of tokens) {
        if (lower.includes(tok)) score += 5;
      }
      const ageHours = (Date.now() - m.lastAccessedAt) / (1000 * 60 * 60);
      score += Math.max(0, 3 - ageHours / 24);
      return { item: m, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.item);
  }

  buildSystemPrompt(params: {
    baseSystemPrompt: string;
    persona: PersonaConfig;
    userText: string;
    contextAnalysis?: ContextAnalysis;
    voiceEmotion?: string;
    speakerLabel?: string;
  }): string {
    const { baseSystemPrompt, persona, userText, contextAnalysis, voiceEmotion, speakerLabel } = params;
    const mind = this.data.mind;
    const relevantMemories = this.selectRelevantMemories(userText, 8);

    const nowText = new Date().toLocaleString("id-ID", {
      dateStyle: "full",
      timeStyle: "short"
    });

    const sections: string[] = [
      `[IDENTITY & PERSONA]`,
      `Current Local Date & Time: ${nowText}`,
      `Name: ${persona.name || "NIKA"}`,
      `Call the user: ${persona.userCallName || "kamu"}`,
      `Personality: ${persona.personality}`,
      `Speaking Style: ${persona.speakingStyle}`,
      persona.backstory ? `Backstory: ${persona.backstory}` : "",
      persona.customInstructions ? `Extra Instructions: ${persona.customInstructions}` : "",
      "",
      `[CURRENT MOOD & FEELINGS]`,
      `Mood: ${mind.mood}`,
      `Happiness: ${mind.happiness}/100, Affection: ${mind.affection}/100, Energy: ${mind.energy}/100, Trust: ${mind.trust}/100`,
      `Let your current mood and feelings subtly shape your tone and emotional reaction, while staying true to your persona.`
    ];

    if (relevantMemories.length > 0) {
      sections.push("", `[LONG-TERM MEMORY ABOUT USER]`);
      for (const mem of relevantMemories) {
        sections.push(`- (${mem.category}) ${mem.content}`);
      }
    }

    sections.push(
      "",
      `[NIKA COGNITIVE BRAIN & SKILLS]`,
      `- reasoning: gunakan brain_reason untuk memecahkan masalah kompleks secara bertahap.`,
      `- long-term-memory: gunakan memory_remember / memory_recall / memory_forget.`,
      `- context-awareness: pahami niat, topik, dan konteks emosional percakapan.`,
      `- planning-agent: gunakan brain_plan_create & brain_plan_update untuk tugas multi-langkah.`,
      `- self-reflection: gunakan brain_reflect untuk mengevaluasi hasil kerja sebelum menjawab.`,
      `- multi-agent-orchestration: gunakan brain_orchestrate untuk menjalankan sub-agent spesialis (researcher, reasoner, planner, critic) secara paralel.`,
      `- web-agent: gunakan web_news untuk berita/headline hari ini, web_search untuk pencarian umum, dan web_browse untuk membuka serta membaca isi halaman/artikel secara langsung (jangan pernah berhenti hanya di daftar nama situs).`,
      `- desktop-automation: gunakan computer_use (aplikasi/mouse/keyboard), playwright_automate (otomatisasi website multi-langkah), file_list/file_read/file_write/file_delete (file-manager), terminal_run (PowerShell), screen_understand (melihat layar), dan camera_see (melihat lewat webcam).`,
      `- game-companion: gunakan game_screen_vision (baca HUD/layar game), game_state_detect (deteksi fase game), game_strategy (saran taktis), game_event_react (reaksi kemenangan/kalah/boss), dan game_control (kontrol input game WASD/mouse).`,
      `- knowledge-research: gunakan web_research (riset internet mendalam & baca halaman), document_read (baca PDF/DOCX/dokumen), code_assist (cari kode/inspeksi/cek pemrograman), knowledge_manage (kelola basis pengetahuan lokal), dan fact_check (verifikasi kebenaran klaim dengan bukti).`,
      `- system-ops: gunakan system_monitor (pantau CPU/RAM/GPU), task_schedule (jadwalkan tugas/pengingat), notify_send (kirim notifikasi desktop), error_recover (pulihkan proses voice/camera/browser yang gagal), dan permission_manage (atur izin tindakan agent).`
    );

    if (contextAnalysis) {
      sections.push(
        "",
        `[CONTEXT AWARENESS]`,
        `Intent: ${contextAnalysis.intent} | Complexity: ${contextAnalysis.complexity}`,
        `Topic Focus: ${contextAnalysis.topic}`,
        `Recommended Skills: ${contextAnalysis.suggestedSkills.join(", ")}`
      );
    }

    if (voiceEmotion || speakerLabel) {
      sections.push(
        "",
        `[VOICE & SPEAKER CONTEXT]`,
        speakerLabel ? `Current Speaker: ${speakerLabel}` : "",
        voiceEmotion ? `Detected User Voice Emotion: ${voiceEmotion} (respond with matching empathy/tone)` : ""
      );
    }

    sections.push("", HUMANIZER_PROMPT_RULES, "", `[RESPONSE RULES]`, baseSystemPrompt);

    return sections.filter((line) => line !== undefined).join("\n");
  }
}

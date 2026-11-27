import type { LLMProvider } from "../../shared/interfaces/index.js";
import type { AIConfig, ChatMessage, MemoryItem } from "../../shared/types/index.js";
import { Logger } from "../core/logging/Logger.js";

const STRAY_SCRIPT_REGEX = /[\u4e00-\u9fff\u3040-\u30ff\u0e00-\u0e7f\u0600-\u06ff]/;

export class TranscriptCorrector {
  private readonly logger = new Logger("TranscriptCorrector");

  constructor(private readonly provider: LLMProvider) {}

  /**
   * Instant phonetic & domain normalization for common Indonesian/English STT mishearings.
   */
  quickNormalize(raw: string): string {
    let text = raw.replace(/\s+/g, " ").trim();
    if (!text) return "";

    // Remove stray non-Latin scripts occasionally emitted by multilingual STT
    if (STRAY_SCRIPT_REGEX.test(text)) {
      text = text.replace(STRAY_SCRIPT_REGEX, "").replace(/\s+/g, " ").trim();
    }

    // Domain & name phonetic corrections
    text = text.replace(/\b(?:halo|hai|hi|hey|ok|oke|eh|kak)\s+(?:nikah|nicha|neka|mika)\b/gi, (m) =>
      m.replace(/\b(?:nikah|nicha|neka|mika)\b/i, "Nika")
    );
    text = text.replace(/^(?:nikah|nicha|neka)\b/i, "Nika");
    text = text.replace(/\b(?:nikah|nicha|neka)\s+(?:tolong|coba|cari|jelasin|bisa|apa|kenapa)\b/gi, (m) =>
      m.replace(/\b(?:nikah|nicha|neka)\b/i, "Nika")
    );
    text = text.replace(/\b(?:nine\s*router|sembilan\s*router|9\s*router)\b/gi, "9Router");
    text = text.replace(/\b(?:vituber|fituber|v\.?\s*tuber)\b/gi, "VTuber");
    text = text.replace(/\b(?:te\s*te\s*es|t\.t\.s)\b/gi, "TTS");
    text = text.replace(/\b(?:es\s*te\s*te|s\.t\.t)\b/gi, "STT");

    // Collapse accidental immediate word stutters ("aku aku mau" -> "aku mau")
    text = text.replace(/\b([a-zA-Z]{2,})\s+\1\b/gi, "$1");

    return text.replace(/\s+/g, " ").trim();
  }

  needsContextRepair(raw: string, normalized: string, confidence?: number): boolean {
    if (!normalized) return false;
    if (STRAY_SCRIPT_REGEX.test(raw)) return true;
    if (confidence !== undefined && confidence > 0 && confidence < 0.84) return true;
    const words = normalized.split(/\s+/).filter(Boolean);
    return words.length >= 3;
  }

  async correct(params: {
    text: string;
    confidence?: number;
    isVoiceInput?: boolean;
    config: AIConfig;
    recentHistory: ChatMessage[];
    memories: MemoryItem[];
  }): Promise<{ rawText: string; correctedText: string; wasModified: boolean }> {
    const rawText = params.text.trim();
    const quick = this.quickNormalize(rawText);

    if (
      !params.isVoiceInput ||
      !quick ||
      !params.config.model ||
      !this.needsContextRepair(rawText, quick, params.confidence)
    ) {
      return {
        rawText,
        correctedText: quick || rawText,
        wasModified: Boolean(quick && quick !== rawText)
      };
    }

    const recentCtx = params.recentHistory
      .slice(-4)
      .map((m) => `${m.role === "user" ? "User" : "Nika"}: ${m.content.slice(0, 120)}`)
      .join("\n");

    const memoryCtx = params.memories
      .slice(0, 5)
      .map((m) => `- ${m.content}`)
      .join("\n");

    const systemPrompt = [
      "Kamu adalah korektor transkrip STT (Speech-to-Text) berbahasa Indonesia & Inggris untuk asisten AI bernama Nika.",
      "Tugasmu: perbaiki HANYA jika ada kata yang salah dengar secara fonetik, typo STT, atau kata yang janggal agar sesuai konteks percakapan.",
      "Jika kalimat sudah masuk akal dan jelas, kembalikan PERSIS apa adanya.",
      "ATURAN KETAT: Jangan menjawab pertanyaan user! Kembalikan HANYA teks kalimat hasil perbaikan (tanpa tanda kutip, tanpa penjelasan, tanpa awalan apapun)."
    ].join("\n");

    const userPrompt = [
      recentCtx ? `Konteks percakapan terakhir:\n${recentCtx}` : "",
      memoryCtx ? `Info tentang user:\n${memoryCtx}` : "",
      `Transkrip STT (confidence ${params.confidence ?? "unknown"}): ${quick}`
    ]
      .filter(Boolean)
      .join("\n\n");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);

    try {
      const effectiveModel =
        params.config.model === "auto" ? undefined : params.config.model;
      if (!effectiveModel) {
        return {
          rawText,
          correctedText: quick,
          wasModified: quick !== rawText
        };
      }

      const { fullText } = await this.provider.streamChat({
        messages: [
          { id: "sys", role: "system", content: systemPrompt, timestamp: 0 },
          { id: "usr", role: "user", content: userPrompt, timestamp: Date.now() }
        ],
        config: {
          ...params.config,
          model: effectiveModel,
          temperature: 0.1,
          maxTokens: 120,
          reasoningEffort: "none"
        },
        signal: controller.signal,
        onChunk: () => {}
      });

      const candidate = fullText
        .trim()
        .replace(/^["'“”]+|["'“”]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();

      // Guard against hallucinated answers or empty outputs
      if (
        candidate.length >= 2 &&
        candidate.length <= Math.max(40, quick.length * 2.2) &&
        !/^\[(?:neutral|happy|sad|angry|surprised|thinking|laugh)\]/i.test(candidate)
      ) {
        return {
          rawText,
          correctedText: candidate,
          wasModified: candidate !== rawText
        };
      }
    } catch (err) {
      this.logger.warn(
        `Context STT repair skipped: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      clearTimeout(timer);
    }

    return {
      rawText,
      correctedText: quick,
      wasModified: quick !== rawText
    };
  }
}

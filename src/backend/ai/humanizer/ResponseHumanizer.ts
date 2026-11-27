export const HUMANIZER_PROMPT_RULES = `[HUMANIZER & NATURAL SPEECH RULES]
- Bicara seperti teman manusia yang hangat, santai, dan tulus — BUKAN seperti asisten AI atau mesin pencari.
- DILARANG memakai gaya AI kaku seperti "Sebagai AI...", "Berikut adalah...", "Tentu, saya dapat membantu...", atau daftar bernomor (1, 2, 3) dan bullet point.
- Jika baru saja mencari dari web, ceritakan intinya dengan bahasa lisan yang natural (misal: "Barusan aku cek, ternyata..."), jangan tempel mentah teks hasil pencarian atau URL.
- DILARANG memakai markdown (**, *, #, backtick), emoji, atau deskripsi aksi seperti *tersenyum* atau (tertawa).
- Gunakan kalimat lisan yang mengalir santai, tidak terburu-buru, dan enak didengar saat diucapkan.`;

const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu;

/**
 * Cleans and humanizes raw LLM text before display/TTS so it sounds natural
 * when spoken aloud without markdown, raw URLs, emojis, or robotic symbols.
 */
export function humanizeForSpeech(raw: string): string {
  let text = raw;

  // Remove stray inline emotion/stage tags like [happy] or (tertawa) or *tersenyum*
  text = text.replace(/\[(?:neutral|happy|sad|angry|surprised|thinking|laugh)\]/gi, "");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/\*[^*\n]{1,30}\*/g, (match) => {
    const inner = match.slice(1, -1).trim();
    if (/^(?:tertawa|tersenyum|senyum|menghela|geleng|angguk|blush|sigh|laugh|smile|giggle)/i.test(inner)) {
      return "";
    }
    return inner;
  });
  text = text.replace(/\((?:tertawa|tersenyum|senyum|menghela napas|sigh|laughs?|smiles?)[^)]*\)/gi, "");

  // Convert markdown links [label](url) -> label
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, "$1");

  // Remove bare URLs so TTS doesn't spell out https://...
  text = text.replace(/https?:\/\/\S+/gi, "");

  // Strip remaining markdown syntax
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/(^|\n)\s{0,3}#{1,6}\s+/g, "$1");
  text = text.replace(/(^|\n)\s*[-*•]\s+/g, "$1");
  text = text.replace(/(^|\n)\s*\d+\.\s+/g, "$1");
  text = text.replace(/^>\s+/gm, "");

  // Remove emojis
  text = text.replace(EMOJI_REGEX, "");

  // Naturalize common symbols for Indonesian/English speech
  text = text.replace(/\s*&\s*/g, " dan ");
  text = text.replace(/(\d+)\s*%/g, "$1 persen");
  text = text.replace(/\s*[—–]\s*/g, ", ");
  text = text.replace(/\s*;\s*/g, ", ");

  // Collapse repeated punctuation and whitespace
  text = text.replace(/([,.!?])\1+/g, "$1");
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

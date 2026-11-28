import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import type { AgentBrowserService } from "../browser/AgentBrowserService.js";

const execFileAsync = promisify(execFile);

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  source?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentReadResult {
  path: string;
  ext: string;
  sizeBytes: number;
  totalChars: number;
  returnedChars: number;
  truncated: boolean;
  content: string;
  extractor: string;
}

export class KnowledgeAssistantService {
  private readonly kbFilePath: string;
  private entries: KnowledgeEntry[] = [];

  constructor(userDataDir: string) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.kbFilePath = path.join(userDataDir, "knowledge-base.json");
    this.loadKb();
  }

  private loadKb(): void {
    if (!fs.existsSync(this.kbFilePath)) {
      this.entries = [];
      return;
    }
    try {
      const raw = fs.readFileSync(this.kbFilePath, "utf-8");
      const parsed = JSON.parse(raw);
      this.entries = Array.isArray(parsed) ? (parsed as KnowledgeEntry[]) : [];
    } catch {
      this.entries = [];
    }
  }

  private saveKb(): void {
    fs.writeFileSync(this.kbFilePath, JSON.stringify(this.entries, null, 2), "utf-8");
  }

  /** knowledge-base: add/update/search/list/delete */
  addKnowledge(params: {
    title: string;
    content: string;
    tags?: string[];
    source?: string;
  }): KnowledgeEntry {
    const now = new Date().toISOString();
    const entry: KnowledgeEntry = {
      id: `kb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: params.title.trim(),
      content: params.content.trim(),
      tags: (params.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
      ...(params.source ? { source: params.source.trim() } : {}),
      createdAt: now,
      updatedAt: now
    };
    this.entries.unshift(entry);
    this.saveKb();
    return entry;
  }

  searchKnowledge(query: string, limit = 8): KnowledgeEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.entries.slice(0, limit);
    const terms = q.split(/\s+/).filter(Boolean);
    return this.entries
      .map((entry) => {
        const hay = `${entry.title} ${entry.tags.join(" ")} ${entry.content}`.toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (entry.title.toLowerCase().includes(t)) score += 3;
          if (entry.tags.some((tag) => tag.includes(t))) score += 2;
          if (hay.includes(t)) score += 1;
        }
        return { entry, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.entry);
  }

  listKnowledge(limit = 20): KnowledgeEntry[] {
    return this.entries.slice(0, limit);
  }

  deleteKnowledge(idOrTitle: string): boolean {
    const key = idOrTitle.trim().toLowerCase();
    const before = this.entries.length;
    this.entries = this.entries.filter(
      (e) => e.id.toLowerCase() !== key && e.title.toLowerCase() !== key
    );
    if (this.entries.length !== before) {
      this.saveKb();
      return true;
    }
    return false;
  }

  /** document-reader: read TXT/MD/JSON/CSV/HTML/DOCX/PDF */
  async readDocument(
    filePath: string,
    maxChars = 12000,
    startChar = 0
  ): Promise<DocumentReadResult> {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File tidak ditemukan: ${resolved}`);
    }
    const stat = fs.statSync(resolved);
    const ext = path.extname(resolved).toLowerCase();

    let text = "";
    let extractor = "utf8-text";

    if (ext === ".pdf") {
      const extracted = await this.extractPdfText(resolved);
      text = extracted.text;
      extractor = extracted.extractor;
    } else if (ext === ".docx") {
      const extracted = await this.extractDocxText(resolved);
      text = extracted.text;
      extractor = extracted.extractor;
    } else {
      text = fs.readFileSync(resolved, "utf-8");
      if (ext === ".html" || ext === ".htm") {
        text = text.replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        extractor = "html-stripped";
      }
    }

    const safeStart = Math.max(0, startChar);
    const slice = text.slice(safeStart, safeStart + maxChars);
    return {
      path: resolved,
      ext,
      sizeBytes: stat.size,
      totalChars: text.length,
      returnedChars: slice.length,
      truncated: safeStart + slice.length < text.length,
      content: slice,
      extractor
    };
  }

  private async extractPdfText(pdfPath: string): Promise<{ text: string; extractor: string }> {
    // 1. Try pdftotext if installed
    try {
      const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"], {
        timeout: 15000,
        maxBuffer: 10 * 1024 * 1024
      });
      if (stdout.trim()) {
        return { text: stdout.trim(), extractor: "pdftotext" };
      }
    } catch {
      // fallback
    }

    // 2. Try Python (pypdf / fitz / pdfplumber)
    const pyScript = [
      "import sys",
      "p = sys.argv[1]",
      "for mod in ('pypdf', 'PyPDF2', 'fitz', 'pdfplumber'):",
      "  try:",
      "    if mod in ('pypdf', 'PyPDF2'):",
      "      m = __import__(mod)",
      "      r = m.PdfReader(p)",
      "      print('\\n'.join((page.extract_text() or '') for page in r.pages))",
      "      sys.exit(0)",
      "    elif mod == 'fitz':",
      "      import fitz",
      "      doc = fitz.open(p)",
      "      print('\\n'.join(page.get_text() for page in doc))",
      "      sys.exit(0)",
      "    elif mod == 'pdfplumber':",
      "      import pdfplumber",
      "      with pdfplumber.open(p) as pdf:",
      "        print('\\n'.join((page.extract_text() or '') for page in pdf.pages))",
      "      sys.exit(0)",
      "  except Exception:",
      "    pass",
      "sys.exit(2)"
    ].join("\n");

    try {
      const { stdout } = await execFileAsync("python", ["-c", pyScript, pdfPath], {
        timeout: 15000,
        maxBuffer: 10 * 1024 * 1024
      });
      if (stdout.trim()) {
        return { text: stdout.trim(), extractor: "python-pdf" };
      }
    } catch {
      // fallback
    }

    // 3. Lightweight pure-Node fallback for uncompressed/literal PDF text operators (...) Tj / TJ
    const buf = fs.readFileSync(pdfPath);
    const latin = buf.toString("latin1");
    const chunks: string[] = [];
    const regex = /\(([^()\\]{2,200})\)\s*(?:Tj|')/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(latin)) !== null) {
      const cleaned = m[1].replace(/[^\x20-\x7E\r\n]/g, " ").trim();
      if (cleaned) chunks.push(cleaned);
      if (chunks.length > 5000) break;
    }
    if (chunks.length > 0) {
      return { text: chunks.join(" "), extractor: "pdf-literal-fallback" };
    }
    throw new Error(
      "PDF terkompresi tidak bisa diekstrak tanpa `pdftotext` atau library Python `pypdf`/`pymupdf`."
    );
  }

  private async extractDocxText(docxPath: string): Promise<{ text: string; extractor: string }> {
    const pyScript = [
      "import sys, zipfile, xml.etree.ElementTree as ET",
      "with zipfile.ZipFile(sys.argv[1]) as z:",
      "  xml_data = z.read('word/document.xml')",
      "root = ET.fromstring(xml_data)",
      "texts = [el.text for el in root.iter() if el.tag.endswith('}t') and el.text]",
      "print(' '.join(texts))"
    ].join("\n");
    const { stdout } = await execFileAsync("python", ["-c", pyScript, docxPath], {
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024
    });
    return { text: stdout.trim(), extractor: "python-docx-xml" };
  }

  /** web-research: search and read top pages */
  async researchWeb(
    browserService: AgentBrowserService,
    query: string,
    maxPages = 2
  ): Promise<{
    query: string;
    searchUrl: string;
    resultsText: string;
    pages: Array<{ url: string; title: string; content: string; error?: string }>;
  }> {
    const search = await browserService.search(query);
    const combined = `${search.resultsText}\n${search.interactiveRefs}`;
    const urlMatches = combined.match(/https?:\/\/[^\s"'<>)\]]+/gi) ?? [];
    const candidateUrls: string[] = [];
    for (const rawUrl of urlMatches) {
      const cleaned = rawUrl.replace(/[.,;]+$/, "");
      if (!/bing\.com|microsoft\.com\/bing/i.test(cleaned) && !candidateUrls.includes(cleaned)) {
        candidateUrls.push(cleaned);
      }
      if (candidateUrls.length >= Math.max(1, Math.min(maxPages, 4))) break;
    }

    const pages: Array<{ url: string; title: string; content: string; error?: string }> = [];
    for (const targetUrl of candidateUrls) {
      try {
        const page = await browserService.browse(targetUrl);
        pages.push({
          url: page.url || targetUrl,
          title: page.title || targetUrl,
          content: page.text
        });
      } catch (err) {
        pages.push({
          url: targetUrl,
          title: targetUrl,
          content: "",
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    return {
      query,
      searchUrl: search.url,
      resultsText: search.resultsText,
      pages
    };
  }

  /** fact-checker: cross-check claim against local KB + live web evidence */
  async checkFact(
    browserService: AgentBrowserService,
    claim: string
  ): Promise<{
    claim: string;
    localKnowledgeMatches: KnowledgeEntry[];
    webEvidence: Array<{ url: string; title: string; content: string; error?: string }>;
    searchSummary: string;
  }> {
    const localKnowledgeMatches = this.searchKnowledge(claim, 4);
    const research = await this.researchWeb(browserService, claim, 2);
    return {
      claim,
      localKnowledgeMatches,
      webEvidence: research.pages,
      searchSummary: research.resultsText
    };
  }
}

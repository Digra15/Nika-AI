import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { Logger } from "../core/logging/Logger.js";

const execFileAsync = promisify(execFile);

function findSystemBrowserExecutable(): string | undefined {
  const candidates = [
    process.env.AGENT_BROWSER_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ];
  return candidates.find((p): p is string => Boolean(p && fs.existsSync(p)));
}

function truncateText(text: string, maxLen = 3600): string {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen)}\n...[truncated]`;
}

export class AgentBrowserService {
  private readonly logger = new Logger("AgentBrowserService");
  private readonly projectRoot: string;
  private readonly sessionName = "nika-web";
  private readonly executablePath: string | undefined;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.executablePath = findSystemBrowserExecutable();
  }

  private resolveCli(): { cmd: string; prefixArgs: string[]; useShell: boolean } {
    if (process.platform === "win32") {
      const nativeExe = path.join(
        this.projectRoot,
        "node_modules",
        "agent-browser",
        "bin",
        "agent-browser-win32-x64.exe"
      );
      if (fs.existsSync(nativeExe)) {
        return { cmd: nativeExe, prefixArgs: [], useShell: false };
      }
      const localCmd = path.join(this.projectRoot, "node_modules", ".bin", "agent-browser.cmd");
      if (fs.existsSync(localCmd)) {
        return { cmd: localCmd, prefixArgs: [], useShell: true };
      }
      return { cmd: "npx.cmd", prefixArgs: ["--no-install", "agent-browser"], useShell: true };
    }

    const localBin = path.join(this.projectRoot, "node_modules", ".bin", "agent-browser");
    if (fs.existsSync(localBin)) {
      return { cmd: localBin, prefixArgs: [], useShell: false };
    }
    return {
      cmd: "npx",
      prefixArgs: ["--no-install", "agent-browser"],
      useShell: false
    };
  }

  private async run(args: string[], timeoutMs = 25000): Promise<string> {
    const { cmd, prefixArgs, useShell } = this.resolveCli();
    const fullArgs = [
      ...prefixArgs,
      "--session",
      this.sessionName,
      "--ignore-https-errors",
      ...args
    ];

    try {
      const { stdout, stderr } = await execFileAsync(cmd, fullArgs, {
        cwd: this.projectRoot,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        shell: useShell,
        env: {
          ...process.env,
          ...(this.executablePath
            ? { AGENT_BROWSER_EXECUTABLE_PATH: this.executablePath }
            : {})
        }
      });
      return (stdout || stderr || "").trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`agent-browser error (${args.join(" ")}): ${msg}`);
      throw new Error(`agent-browser failed: ${msg}`);
    }
  }

  async search(query: string): Promise<{
    query: string;
    url: string;
    resultsText: string;
    interactiveRefs: string;
  }> {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    await this.run(["open", url], 30000);
    const [resultsOnly, bodyText, snapshot] = await Promise.all([
      this.run(["get", "text", "#b_results"], 12000).catch(() => ""),
      this.run(["get", "text", "body"], 12000).catch(() => ""),
      this.run(["snapshot", "-i"], 12000).catch(() => "")
    ]);

    return {
      query,
      url,
      resultsText: truncateText(resultsOnly || bodyText, 3400),
      interactiveRefs: truncateText(snapshot, 1800)
    };
  }

  async browse(url: string): Promise<{
    url: string;
    title: string;
    text: string;
    interactiveRefs: string;
  }> {
    const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    await this.run(["open", normalizedUrl], 30000);
    const [currentUrl, title, text, snapshot] = await Promise.all([
      this.run(["get", "url"], 10000).catch(() => normalizedUrl),
      this.run(["get", "title"], 10000).catch(() => ""),
      this.run(["get", "text", "body"], 15000).catch(() => ""),
      this.run(["snapshot", "-i"], 15000).catch(() => "")
    ]);

    return {
      url: currentUrl,
      title,
      text: truncateText(text, 3200),
      interactiveRefs: truncateText(snapshot, 1800)
    };
  }

  async interact(params: {
    action: "click" | "fill" | "press" | "scroll";
    target: string;
    value?: string;
  }): Promise<{ url: string; interactiveRefs: string; text: string }> {
    const { action, target, value } = params;
    if (action === "click") {
      await this.run(["click", target], 15000);
    } else if (action === "fill") {
      await this.run(["fill", target, value ?? ""], 15000);
    } else if (action === "press") {
      await this.run(["press", target], 15000);
    } else if (action === "scroll") {
      await this.run(["scroll", target || "down", value || "600"], 15000);
    }

    const [url, snapshot, text] = await Promise.all([
      this.run(["get", "url"], 10000).catch(() => ""),
      this.run(["snapshot", "-i"], 15000).catch(() => ""),
      this.run(["get", "text", "body"], 15000).catch(() => "")
    ]);

    return {
      url,
      interactiveRefs: truncateText(snapshot, 1800),
      text: truncateText(text, 2400)
    };
  }

  isReady(): boolean {
    const { cmd } = this.resolveCli();
    const hasCli = cmd.includes("npx") || fs.existsSync(cmd);
    return hasCli && Boolean(this.executablePath);
  }

  async close(): Promise<void> {
    await this.run(["close"], 5000).catch(() => {});
  }
}

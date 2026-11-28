import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const BLOCKED_TERMINAL_PATTERNS = [
  /\bformat\s+[a-z]:/i,
  /\bshutdown\b/i,
  /\bdel\s+.*\/s\s+.*\/q\s+[a-z]:\\/i,
  /remove-item\s+.*-recurse.*-force\s+[a-z]:\\$/i,
  /\brd\s+\/s\s+\/q\s+[a-z]:\\/i
];

function isPathAllowed(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const lower = resolved.toLowerCase();
  const forbiddenRoots = [
    "c:\\windows",
    "c:\\program files",
    "c:\\program files (x86)",
    "c:\\programdata"
  ];
  return !forbiddenRoots.some((root) => lower === root || lower.startsWith(`${root}\\`));
}

export class DesktopControlService {
  private readonly defaultWorkDir: string;

  constructor(projectRoot: string) {
    this.defaultWorkDir = projectRoot || os.homedir();
  }

  private async runPowerShell(script: string, timeoutMs = 15000): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    try {
      const { stdout, stderr } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          cwd: this.defaultWorkDir,
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024,
          windowsHide: true
        }
      );
      return {
        exitCode: 0,
        stdout: (stdout || "").trim().slice(0, 5000),
        stderr: (stderr || "").trim().slice(0, 2000)
      };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        exitCode: typeof e.code === "number" ? e.code : 1,
        stdout: (e.stdout || "").trim().slice(0, 5000),
        stderr: (e.stderr || e.message || String(err)).trim().slice(0, 2000)
      };
    }
  }

  /** terminal-executor */
  async executeTerminal(command: string, cwd?: string): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    const clean = command.trim();
    if (!clean) {
      return { exitCode: 1, stdout: "", stderr: "Empty command" };
    }
    if (BLOCKED_TERMINAL_PATTERNS.some((pat) => pat.test(clean))) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "Blocked potentially destructive system command"
      };
    }
    const workDir = cwd && isPathAllowed(cwd) && fs.existsSync(cwd) ? cwd : this.defaultWorkDir;
    try {
      const { stdout, stderr } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", clean],
        {
          cwd: workDir,
          timeout: 20000,
          maxBuffer: 1024 * 1024,
          windowsHide: true
        }
      );
      return {
        exitCode: 0,
        stdout: (stdout || "").trim().slice(0, 5000),
        stderr: (stderr || "").trim().slice(0, 2000)
      };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        exitCode: typeof e.code === "number" ? e.code : 1,
        stdout: (e.stdout || "").trim().slice(0, 5000),
        stderr: (e.stderr || e.message || String(err)).trim().slice(0, 2000)
      };
    }
  }

  /** file-manager */
  listFiles(dirPath?: string): { path: string; entries: Array<{ name: string; type: "file" | "dir"; size: number }> } {
    const target = path.resolve(dirPath || this.defaultWorkDir);
    if (!isPathAllowed(target)) {
      throw new Error(`Access denied to system path: ${target}`);
    }
    const items = fs.readdirSync(target, { withFileTypes: true }).slice(0, 80);
    return {
      path: target,
      entries: items.map((d) => {
        let size = 0;
        if (d.isFile()) {
          try {
            size = fs.statSync(path.join(target, d.name)).size;
          } catch {
            size = 0;
          }
        }
        return {
          name: d.name,
          type: d.isDirectory() ? "dir" : "file",
          size
        };
      })
    };
  }

  readFileSafe(filePath: string): { path: string; content: string; truncated: boolean } {
    const target = path.resolve(filePath);
    if (!isPathAllowed(target)) {
      throw new Error(`Access denied to system path: ${target}`);
    }
    const raw = fs.readFileSync(target, "utf-8");
    const maxLen = 6000;
    return {
      path: target,
      content: raw.slice(0, maxLen),
      truncated: raw.length > maxLen
    };
  }

  writeFileSafe(filePath: string, content: string): { path: string; bytesWritten: number } {
    const target = path.resolve(filePath);
    if (!isPathAllowed(target)) {
      throw new Error(`Access denied to system path: ${target}`);
    }
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(target, content, "utf-8");
    return { path: target, bytesWritten: Buffer.byteLength(content, "utf-8") };
  }

  deleteFileSafe(filePath: string): { deleted: boolean; path: string } {
    const target = path.resolve(filePath);
    if (!isPathAllowed(target)) {
      throw new Error(`Access denied to system path: ${target}`);
    }
    if (!fs.existsSync(target)) {
      return { deleted: false, path: target };
    }
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true });
    } else {
      fs.unlinkSync(target);
    }
    return { deleted: true, path: target };
  }

  /** computer-use */
  async computerAction(params: {
    action: "open_app" | "open_url" | "mouse_click" | "mouse_move" | "type_text" | "key_press" | "active_window";
    target?: string;
    x?: number;
    y?: number;
    button?: "left" | "right" | "double";
  }): Promise<Record<string, unknown>> {
    const { action, target = "", x = 0, y = 0, button = "left" } = params;

    if (action === "open_app" || action === "open_url") {
      const safeTarget = target.replace(/'/g, "''").trim();
      if (!safeTarget) return { ok: false, error: "Target app/URL required" };
      const res = await this.runPowerShell(`Start-Process '${safeTarget}'`);
      return { ok: res.exitCode === 0, action, target, error: res.stderr || undefined };
    }

    if (action === "active_window") {
      const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinInfo {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
$h = [WinInfo]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][WinInfo]::GetWindowText($h, $sb, $sb.Capacity)
$titles = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 12 -ExpandProperty MainWindowTitle
@{ active = $sb.ToString(); windows = @($titles) } | ConvertTo-Json -Compress
`;
      const res = await this.runPowerShell(script);
      try {
        return JSON.parse(res.stdout) as Record<string, unknown>;
      } catch {
        return { active: res.stdout, error: res.stderr || undefined };
      }
    }

    if (action === "mouse_move" || action === "mouse_click") {
      const ix = Math.round(x);
      const iy = Math.round(y);
      const clickCode =
        action === "mouse_move"
          ? ""
          : button === "right"
            ? "[MouseOps]::mouse_event(0x0008,0,0,0,0); [MouseOps]::mouse_event(0x0010,0,0,0,0);"
            : button === "double"
              ? "[MouseOps]::mouse_event(0x0002,0,0,0,0); [MouseOps]::mouse_event(0x0004,0,0,0,0); Start-Sleep -Milliseconds 60; [MouseOps]::mouse_event(0x0002,0,0,0,0); [MouseOps]::mouse_event(0x0004,0,0,0,0);"
              : "[MouseOps]::mouse_event(0x0002,0,0,0,0); [MouseOps]::mouse_event(0x0004,0,0,0,0);";
      const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System.Runtime.InteropServices;
public class MouseOps {
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
}
"@
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${ix}, ${iy})
${clickCode}
`;
      const res = await this.runPowerShell(script);
      return { ok: res.exitCode === 0, action, x: ix, y: iy, button };
    }

    if (action === "type_text" || action === "key_press") {
      const escaped = target.replace(/'/g, "''");
      const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
`;
      const res = await this.runPowerShell(script);
      return { ok: res.exitCode === 0, action, target };
    }

    return { ok: false, error: `Unknown computer action: ${action}` };
  }
}

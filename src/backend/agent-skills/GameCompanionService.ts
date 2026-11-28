import { execFile } from "child_process";
import { promisify } from "util";
import type { EmotionType } from "../../shared/types/index.js";

const execFileAsync = promisify(execFile);

export type GamePhase =
  | "idle"
  | "menu"
  | "exploring"
  | "combat"
  | "boss"
  | "victory"
  | "defeat"
  | "paused";

export type GameEventKind =
  | "victory"
  | "defeat"
  | "boss"
  | "low_hp"
  | "clutch"
  | "level_up";

export interface GameStateSnapshot {
  gameTitle: string;
  phase: GamePhase;
  playerStatus: string;
  lastEvent: string;
  updatedAt: number;
}

const VK_MAP: Record<string, number> = {
  W: 0x57,
  A: 0x41,
  S: 0x53,
  D: 0x44,
  E: 0x45,
  F: 0x46,
  Q: 0x51,
  R: 0x52,
  G: 0x47,
  I: 0x49,
  M: 0x4d,
  SPACE: 0x20,
  ENTER: 0x0d,
  ESC: 0x1b,
  TAB: 0x09,
  SHIFT: 0x10,
  CTRL: 0x11,
  UP: 0x26,
  DOWN: 0x28,
  LEFT: 0x25,
  RIGHT: 0x27,
  "1": 0x31,
  "2": 0x32,
  "3": 0x33,
  "4": 0x34,
  "5": 0x35
};

export class GameCompanionService {
  private state: GameStateSnapshot = {
    gameTitle: "Unknown",
    phase: "idle",
    playerStatus: "",
    lastEvent: "",
    updatedAt: Date.now()
  };

  getState(): GameStateSnapshot {
    return { ...this.state };
  }

  updateState(patch: Partial<Omit<GameStateSnapshot, "updatedAt">>): GameStateSnapshot {
    this.state = {
      ...this.state,
      ...patch,
      updatedAt: Date.now()
    };
    return this.getState();
  }

  mapEventReaction(event: GameEventKind): {
    emotion: EmotionType;
    gesture: "cheer" | "nod" | "tilt" | "bow";
    happinessDelta: number;
    toneHint: string;
  } {
    switch (event) {
      case "victory":
      case "clutch":
        return {
          emotion: "laugh",
          gesture: "cheer",
          happinessDelta: 6,
          toneHint: "Sorak gembira dan puji permainan user dengan antusias!"
        };
      case "level_up":
        return {
          emotion: "happy",
          gesture: "cheer",
          happinessDelta: 4,
          toneHint: "Berikan selamat dengan hangat dan semangat!"
        };
      case "boss":
        return {
          emotion: "surprised",
          gesture: "tilt",
          happinessDelta: 1,
          toneHint: "Waspada, tegang tapi tetap menyemangati user!"
        };
      case "low_hp":
        return {
          emotion: "surprised",
          gesture: "nod",
          happinessDelta: -1,
          toneHint: "Ingatkan user dengan cepat untuk heal, menghindar, atau bertahan!"
        };
      case "defeat":
        return {
          emotion: "sad",
          gesture: "bow",
          happinessDelta: -3,
          toneHint: "Hiburkan user dengan lembut dan ajak bangkit di percobaan berikutnya."
        };
    }
  }

  async sendGameInput(params: {
    action: "key_tap" | "key_hold" | "mouse_click" | "mouse_move_rel";
    key?: string;
    holdMs?: number;
    dx?: number;
    dy?: number;
    button?: "left" | "right";
  }): Promise<Record<string, unknown>> {
    const { action, key = "", holdMs = 120, dx = 0, dy = 0, button = "left" } = params;

    if (action === "key_tap" || action === "key_hold") {
      const upper = key.trim().toUpperCase();
      const vk = VK_MAP[upper];
      if (!vk) {
        return {
          ok: false,
          error: `Unsupported game key "${key}". Supported: ${Object.keys(VK_MAP).join(", ")}`
        };
      }
      const clampedMs = Math.max(40, Math.min(2000, Math.round(action === "key_tap" ? 90 : holdMs)));
      const script = `
Add-Type @"
using System.Runtime.InteropServices;
public class GameKeys {
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
}
"@
$scan = [byte][GameKeys]::MapVirtualKey(${vk}, 0)
[GameKeys]::keybd_event(${vk}, $scan, 0, [System.UIntPtr]::Zero)
Start-Sleep -Milliseconds ${clampedMs}
[GameKeys]::keybd_event(${vk}, $scan, 2, [System.UIntPtr]::Zero)
`;
      try {
        await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
          timeout: 8000,
          windowsHide: true
        });
        return { ok: true, action, key: upper, holdMs: clampedMs };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }

    if (action === "mouse_click" || action === "mouse_move_rel") {
      const idx = Math.round(dx);
      const idy = Math.round(dy);
      const script =
        action === "mouse_move_rel"
          ? `
Add-Type @"
using System.Runtime.InteropServices;
public class GameMouse {
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, System.UIntPtr dwExtraInfo);
}
"@
[GameMouse]::mouse_event(0x0001, ${idx}, ${idy}, 0, [System.UIntPtr]::Zero)
`
          : button === "right"
            ? `
Add-Type @"
using System.Runtime.InteropServices;
public class GameMouse {
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, System.UIntPtr dwExtraInfo);
}
"@
[GameMouse]::mouse_event(0x0008, 0, 0, 0, [System.UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[GameMouse]::mouse_event(0x0010, 0, 0, 0, [System.UIntPtr]::Zero)
`
            : `
Add-Type @"
using System.Runtime.InteropServices;
public class GameMouse {
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, System.UIntPtr dwExtraInfo);
}
"@
[GameMouse]::mouse_event(0x0002, 0, 0, 0, [System.UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[GameMouse]::mouse_event(0x0004, 0, 0, 0, [System.UIntPtr]::Zero)
`;
      try {
        await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
          timeout: 6000,
          windowsHide: true
        });
        return { ok: true, action, dx: idx, dy: idy, button };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }

    return { ok: false, error: `Unknown game input action: ${action}` };
  }
}

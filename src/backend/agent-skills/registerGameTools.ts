import type { AIConfig, EmotionType } from "../../shared/types/index.js";
import type { ToolRegistry } from "../ai/tool-calling/ToolRegistry.js";
import type { MemoryManager } from "../memory/MemoryManager.js";
import type {
  GameCompanionService,
  GameEventKind,
  GamePhase
} from "./GameCompanionService.js";

export function registerGameTools(params: {
  registry: ToolRegistry;
  gameService: GameCompanionService;
  memoryManager: MemoryManager;
  captureScreenSummary: (
    question?: string,
    aiConfig?: AIConfig
  ) => Promise<Record<string, unknown>>;
  getAIConfig: () => AIConfig;
  onReaction?: (reaction: { emotion: EmotionType; gesture: string }) => void;
}): void {
  const {
    registry,
    gameService,
    memoryManager,
    captureScreenSummary,
    getAIConfig,
    onReaction
  } = params;

  /** 1. game-screen-vision */
  registry.register(
    {
      type: "function",
      function: {
        name: "game_screen_vision",
        description:
          "Memahami tampilan layar game (game-screen-vision): membaca HUD, HP/MP, minimap, musuh, skor, menu, atau misi yang sedang tampil.",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "Fokus spesifik pada layar game (misal posisi musuh, HP, atau objektif)."
            }
          }
        }
      }
    },
    async (args) => {
      const prompt =
        (args.question ? String(args.question) : "") ||
        "Analisis tampilan game di layar ini: sebutkan judul/genre game jika terlihat, kondisi HUD (HP/stamina/ammo/skor), bahaya atau musuh di sekitar, dan objektif saat ini secara singkat.";
      return captureScreenSummary(prompt, getAIConfig());
    }
  );

  /** 2. game-state-detection */
  registry.register(
    {
      type: "function",
      function: {
        name: "game_state_detect",
        description:
          "Mengenali dan memperbarui kondisi permainan saat ini (game-state-detection: gameTitle, phase, playerStatus, lastEvent).",
        parameters: {
          type: "object",
          properties: {
            gameTitle: { type: "string" },
            phase: {
              type: "string",
              enum: ["idle", "menu", "exploring", "combat", "boss", "victory", "defeat", "paused"]
            },
            playerStatus: { type: "string" },
            lastEvent: { type: "string" },
            inspectScreen: {
              type: "boolean",
              description: "Jika true, ikut membaca layar game saat ini."
            }
          }
        }
      }
    },
    async (args) => {
      const state = gameService.updateState({
        ...(args.gameTitle ? { gameTitle: String(args.gameTitle) } : {}),
        ...(args.phase ? { phase: args.phase as GamePhase } : {}),
        ...(args.playerStatus ? { playerStatus: String(args.playerStatus) } : {}),
        ...(args.lastEvent ? { lastEvent: String(args.lastEvent) } : {})
      });
      if (args.inspectScreen) {
        const screen = await captureScreenSummary(
          "Identifikasi fase game (menu, exploring, combat, boss, victory, defeat) dan status pemain dari layar ini.",
          getAIConfig()
        );
        return { state, screen };
      }
      return { state };
    }
  );

  /** 3. game-strategy */
  registry.register(
    {
      type: "function",
      function: {
        name: "game_strategy",
        description:
          "Menyusun strategi dan saran taktis berdasarkan kondisi permainan saat ini (game-strategy).",
        parameters: {
          type: "object",
          properties: {
            situation: {
              type: "string",
              description: "Situasi game atau tantangan yang sedang dihadapi pemain."
            }
          },
          required: ["situation"]
        }
      }
    },
    async (args) => {
      const state = gameService.getState();
      return {
        currentGameState: state,
        situation: String(args.situation ?? ""),
        guidance:
          "Berikan strategi ringkas 1-3 poin yang langsung bisa dieksekusi oleh pemain (posisi, prioritas target, manajemen resource/HP)."
      };
    }
  );

  /** 4. game-event-reaction */
  registry.register(
    {
      type: "function",
      function: {
        name: "game_event_react",
        description:
          "Memicu reaksi ekspresif Nika (emosi wajah, gesture avatar, dan mood) terhadap kejadian penting dalam game (victory, defeat, boss, low_hp, clutch, level_up).",
        parameters: {
          type: "object",
          properties: {
            event: {
              type: "string",
              enum: ["victory", "defeat", "boss", "low_hp", "clutch", "level_up"]
            },
            details: { type: "string" }
          },
          required: ["event"]
        }
      }
    },
    async (args) => {
      const ev = (args.event as GameEventKind) || "clutch";
      const reaction = gameService.mapEventReaction(ev);
      gameService.updateState({
        phase: ev === "victory" ? "victory" : ev === "defeat" ? "defeat" : ev === "boss" ? "boss" : gameService.getState().phase,
        lastEvent: args.details ? String(args.details) : ev
      });
      memoryManager.adjustMindExplicit({
        happinessDelta: reaction.happinessDelta
      });
      onReaction?.({ emotion: reaction.emotion, gesture: reaction.gesture });
      return { event: ev, ...reaction };
    }
  );

  /** 5. game-controller */
  registry.register(
    {
      type: "function",
      function: {
        name: "game_control",
        description:
          "Mengendalikan input keyboard/mouse untuk game menggunakan hardware scan-code (WASD, SPACE, SHIFT, E, F, R, Q, 1-5, mouse_click, mouse_move_rel).",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["key_tap", "key_hold", "mouse_click", "mouse_move_rel"]
            },
            key: {
              type: "string",
              description: "Tombol game: W, A, S, D, SPACE, SHIFT, E, F, Q, R, ESC, ENTER, 1-5."
            },
            holdMs: {
              type: "number",
              description: "Durasi tahan tombol dalam ms untuk key_hold (40 - 2000 ms)."
            },
            dx: { type: "number", description: "Gerakan mouse relatif X." },
            dy: { type: "number", description: "Gerakan mouse relatif Y." },
            button: { type: "string", enum: ["left", "right"] }
          },
          required: ["action"]
        }
      }
    },
    async (args) => {
      return gameService.sendGameInput({
        action:
          (args.action as "key_tap" | "key_hold" | "mouse_click" | "mouse_move_rel") ||
          "key_tap",
        key: args.key !== undefined ? String(args.key) : undefined,
        holdMs: args.holdMs !== undefined ? Number(args.holdMs) : undefined,
        dx: args.dx !== undefined ? Number(args.dx) : undefined,
        dy: args.dy !== undefined ? Number(args.dy) : undefined,
        button: (args.button as "left" | "right") || "left"
      });
    }
  );
}

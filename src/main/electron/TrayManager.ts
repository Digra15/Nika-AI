import { Menu, Tray, app, nativeImage, type BrowserWindow } from "electron";

export class TrayManager {
  private tray: Tray | null = null;

  create(
    getWindow: () => BrowserWindow | null,
    onToggleAlwaysOnTop: () => void
  ): void {
    // 16x16 purple-cyan icon encoded as data URL so tray works without external asset dependency
    const icon = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWElEQVR42mP8z8DwnwEJoBhQAxggcP///2QwJ6Ojoz8DAwMDAwMD8f///+QYQIoBrAyMGDEkA1BNoIkB5AY2NjbCDUA1gSYGkBvY2NgINwDVBAyDaBgMAwA3gR8n6p4f1AAAAABJRU5ErkJggg=="
    );
    this.tray = new Tray(icon);
    this.tray.setToolTip("NIKA — Autonomous AI VTuber");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Show NIKA",
        click: () => {
          const win = getWindow();
          if (win) {
            win.show();
            win.focus();
          }
        }
      },
      {
        label: "Toggle Always on Top",
        click: () => onToggleAlwaysOnTop()
      },
      { type: "separator" },
      {
        label: "Quit NIKA",
        click: () => {
          app.quit();
        }
      }
    ]);

    this.tray.setContextMenu(contextMenu);
    this.tray.on("double-click", () => {
      const win = getWindow();
      if (win) {
        win.show();
        win.focus();
      }
    });
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}

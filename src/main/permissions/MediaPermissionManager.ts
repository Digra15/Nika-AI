import { session, systemPreferences } from "electron";

export class MediaPermissionManager {
  async initialize(): Promise<void> {
    if (process.platform === "darwin") {
      await systemPreferences.askForMediaAccess("microphone").catch(() => false);
    }

    session.defaultSession.setPermissionRequestHandler(
      (_webContents, permission, callback) => {
        if (permission === "media") {
          callback(true);
          return;
        }
        callback(false);
      }
    );

    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
      return permission === "media";
    });
  }
}

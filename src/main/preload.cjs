const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nikaAPI", {
  getSettings: () => ipcRenderer.invoke("nika:get-settings"),
  updateSettings: (patch) => ipcRenderer.invoke("nika:update-settings", patch),
  checkRouterHealth: () => ipcRenderer.invoke("nika:router-health"),
  listModels: () => ipcRenderer.invoke("nika:list-models"),
  checkVoiceHealth: () => ipcRenderer.invoke("nika:voice-health"),
  checkSystemReadiness: () => ipcRenderer.invoke("nika:system-readiness"),
  sendChatMessage: (payload) => ipcRenderer.invoke("nika:chat-send", payload),
  abortChat: () => ipcRenderer.invoke("nika:chat-abort"),
  clearHistory: () => ipcRenderer.invoke("nika:chat-clear"),
  getMemorySnapshot: () => ipcRenderer.invoke("nika:get-memory-snapshot"),
  addMemory: (payload) => ipcRenderer.invoke("nika:add-memory", payload),
  deleteMemory: (id) => ipcRenderer.invoke("nika:delete-memory", id),
  clearMemories: () => ipcRenderer.invoke("nika:clear-memories"),
  resetMind: () => ipcRenderer.invoke("nika:reset-mind"),
  synthesizeSpeech: (payload) => ipcRenderer.invoke("nika:tts-synthesize", payload),
  pickAvatarFile: () => ipcRenderer.invoke("nika:pick-avatar"),
  toggleAlwaysOnTop: () => ipcRenderer.invoke("nika:toggle-always-on-top"),
  updateCameraFrame: (base64) => ipcRenderer.invoke("nika:vision-update-camera", base64),
  setLiveVision: (state) => ipcRenderer.invoke("nika:vision-set-live", state),
  onChatStream: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("nika:chat-stream", listener);
    return () => ipcRenderer.removeListener("nika:chat-stream", listener);
  }
});

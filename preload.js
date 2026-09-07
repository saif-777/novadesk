/* Preload bridge: exposes ONLY the desktop Google-login flow to the page.
   Node stays off in the renderer; context isolation stays on. */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("novaDesk", {
  isDesktop: true,
  login: (clientId) => ipcRenderer.invoke("nd-login", clientId),
  refresh: (clientId, refreshToken) => ipcRenderer.invoke("nd-refresh", { clientId, refreshToken })
});

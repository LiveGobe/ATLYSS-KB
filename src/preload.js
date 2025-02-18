const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getAppPath: () => ipcRenderer.invoke('getAppPath'),
    getGameVersion: () => ipcRenderer.invoke('getGameVersion'),
    selectGameSourceFolder: () => ipcRenderer.invoke('selectGameSourceFolder'),
    getConfig: () => ipcRenderer.invoke('getConfig'),
    setConfig: (value) => ipcRenderer.invoke('setConfig', value),
    parseRawData: () => ipcRenderer.invoke("parseRawData"),
    parseData: (parsers) => ipcRenderer.invoke("parseData", parsers),
    getAvailableUploads: () => ipcRenderer.invoke("getAvailableUploads"),
    uploadData: (parsers) => ipcRenderer.invoke("uploadData", parsers),
    onRecieveFilesCount: (callback) => ipcRenderer.on("receiveFilesCount", (e, filesCount, totalCount) => callback(filesCount, totalCount)),
    onStateChange: (callback) => ipcRenderer.on("stateChange", (e, state) => callback(state)),
    onLogMessage: (callback) => ipcRenderer.on("logMessage", (e, message) => callback(message)),
});
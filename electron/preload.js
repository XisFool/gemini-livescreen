const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize:        () => ipcRenderer.send('window-minimize'),
  maximize:        () => ipcRenderer.send('window-maximize'),
  close:           () => ipcRenderer.send('window-close'),
  restoreMain:     () => ipcRenderer.send('restore-main'),
  restoreMainMaximized: () => ipcRenderer.send('restore-main-maximized'),
  openSettings:    () => ipcRenderer.send('open-settings'),
  onMaximizedState: (cb) => ipcRenderer.on('window-maximized-state', (_, isMaximized) => cb(isMaximized)),

  // 迷你窗与主窗口的功能控制（IPC 转发）
  startScreen:     () => ipcRenderer.send('cmd-start-screen'),
  stopScreen:      () => ipcRenderer.send('cmd-stop-screen'),
  toggleVoice:     () => ipcRenderer.send('cmd-toggle-voice'),

  // 迷你窗预览帧接收
  onPreviewFrame:  (cb) => ipcRenderer.on('preview-frame', (_, data) => cb(data)),

  // 主窗口接收来自迷你窗口的控制命令
  onStartScreen:   (cb) => ipcRenderer.on('cmd-start-screen', () => cb()),
  onStopScreen:    (cb) => ipcRenderer.on('cmd-stop-screen', () => cb()),
  onToggleVoice:   (cb) => ipcRenderer.on('cmd-toggle-voice', () => cb()),

  // 音量同步通道
  changeVolume:    (val) => ipcRenderer.send('cmd-change-volume', val),
  onChangeVolume:  (cb) => ipcRenderer.on('cmd-change-volume', (_, val) => cb(val)),

  // 设置页
  saveSettings:    (data) => ipcRenderer.invoke('save-settings', data),
  getSettings:     ()     => ipcRenderer.invoke('get-settings'),
  testConnection:  (data) => ipcRenderer.invoke('test-connection', data),
  getDecryptedApiKey: () => ipcRenderer.invoke('get-decrypted-apikey'),
  resolveSystemProxy: () => ipcRenderer.invoke('resolve-system-proxy'),

  // 主窗口上报屏幕帧给 main.js（供迷你窗预览）
  updatePreviewFrame: (base64JPEG) => ipcRenderer.send('preview-frame-update', base64JPEG),

  // 状态广播同步
  updateState:     (state) => ipcRenderer.send('state-update', state),
  onStateChange:   (cb) => ipcRenderer.on('state-change', (_, state) => cb(state)),
});

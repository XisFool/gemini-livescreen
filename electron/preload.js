const { contextBridge, ipcRenderer } = require('electron');

// 记录所有通过 on 注册的监听器，用于页面销毁时统一清理
const registeredChannels = new Set();

/**
 * 安全包装 ipcRenderer.on：注册监听并记录频道名，
 * 页面 beforeunload 时由 cleanup 统一 removeAllListeners 清理，防止内存泄漏。
 */
function safeOn(channel, listener) {
  registeredChannels.add(channel);
  ipcRenderer.on(channel, listener);
}

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize:        () => ipcRenderer.send('window-minimize'),
  maximize:        () => ipcRenderer.send('window-maximize'),
  close:           () => ipcRenderer.send('window-close'),
  restoreMain:     () => ipcRenderer.send('restore-main'),
  restoreMainMaximized: () => ipcRenderer.send('restore-main-maximized'),
  openSettings:    () => ipcRenderer.send('open-settings'),
  onMaximizedState: (cb) => safeOn('window-maximized-state', (_, isMaximized) => cb(isMaximized)),

  // 迷你窗与主窗口的功能控制（IPC 转发）
  startScreen:     () => ipcRenderer.send('cmd-start-screen'),
  stopScreen:      () => ipcRenderer.send('cmd-stop-screen'),
  toggleVoice:     () => ipcRenderer.send('cmd-toggle-voice'),

  // 迷你窗预览帧接收
  onPreviewFrame:  (cb) => safeOn('preview-frame', (_, data) => cb(data)),

  // 主窗口接收来自迷你窗口的控制命令
  onStartScreen:   (cb) => safeOn('cmd-start-screen', () => cb()),
  onStopScreen:    (cb) => safeOn('cmd-stop-screen', () => cb()),
  onToggleVoice:   (cb) => safeOn('cmd-toggle-voice', () => cb()),

  // 音量同步通道
  changeVolume:    (val) => ipcRenderer.send('cmd-change-volume', val),
  onChangeVolume:  (cb) => safeOn('cmd-change-volume', (_, val) => cb(val)),

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
  onStateChange:   (cb) => safeOn('state-change', (_, state) => cb(state)),

  // 检查更新与下载更新相关
  checkForUpdates:     () => ipcRenderer.send('check-for-updates'),
  startDownloadUpdate: (url) => ipcRenderer.send('start-download-update', url),
  cancelDownloadUpdate: () => ipcRenderer.send('cancel-download-update'),
  onUpdateStatus:      (cb) => safeOn('update-status', (_, data) => cb(data)),
});

// 页面销毁时统一清理所有 IPC 监听器，防止重载时监听器累积
window.addEventListener('beforeunload', () => {
  registeredChannels.forEach(channel => {
    ipcRenderer.removeAllListeners(channel);
  });
  registeredChannels.clear();
});


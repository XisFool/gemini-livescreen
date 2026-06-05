const { app, BrowserWindow, ipcMain, session, desktopCapturer, Tray, Menu, globalShortcut, Notification } = require('electron');
const path = require('path');
const https = require('https');
const tls = require('tls');
const { HttpsProxyAgent } = require('https-proxy-agent');
const store = require('./store');

// 拦截 TLS 建立，防止 HttpsProxyAgent 在握手失败时由于 listeners 被清理导致未捕获的 Socket 错误崩溃
const originalTlsConnect = tls.connect;
tls.connect = function (...args) {
  const socket = originalTlsConnect.apply(this, args);
  if (socket && typeof socket.on === 'function') {
    socket.on('error', (err) => {
      console.warn('[TLS Socket Interceptor] Suppressed socket error to prevent crash:', err.message);
    });
  }
  return socket;
};

let mainWindow = null;
let miniWindow = null;
let settingsWindow = null;
let tray = null;
let isQuitting = false;

function showNotification(title, body) {
  if (Notification.isSupported()) {
    try {
      new Notification({
        title,
        body,
        silent: true // 保持优雅静音
      }).show();
    } catch (e) {
      console.error('Failed to show system notification:', e);
    }
  }
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  try {
    tray = new Tray(iconPath);
  } catch (e) {
    console.warn("Tray icon not found. Falling back to empty nativeImage.");
    const { nativeImage } = require('electron');
    tray = new Tray(nativeImage.createEmpty());
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'LiveScreen 实时屏幕辅导',
      enabled: false
    },
    { type: 'separator' },
    {
      label: '显示主界面',
      click: () => {
        if (miniWindow) miniWindow.hide();
        if (mainWindow) {
          mainWindow.show();
          mainWindow.restore();
        }
      }
    },
    {
      label: '开始屏幕共享',
      click: () => {
        if (mainWindow) mainWindow.webContents.send('cmd-start-screen');
      }
    },
    {
      label: '停止屏幕共享',
      click: () => {
        if (mainWindow) mainWindow.webContents.send('cmd-stop-screen');
      }
    },
    {
      label: '一键开关麦克风',
      click: () => {
        if (mainWindow) mainWindow.webContents.send('cmd-toggle-voice');
      }
    },
    { type: 'separator' },
    {
      label: '打开设置',
      click: () => {
        createSettingsWindow();
      }
    },
    { type: 'separator' },
    {
      label: '退出应用',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setToolTip('LiveScreen 屏幕辅导');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (miniWindow) miniWindow.hide();
    if (mainWindow) {
      mainWindow.show();
      mainWindow.restore();
    }
  });
}

// 辅助函数：解析系统代理配置
async function resolveSystemProxyHelper() {
  try {
    const proxyInfo = await session.defaultSession.resolveProxy('https://generativelanguage.googleapis.com');
    console.log('[Proxy Resolve] Resolved proxy for Gemini API:', proxyInfo);
    if (proxyInfo && proxyInfo !== 'DIRECT') {
      const parts = proxyInfo.split(';');
      for (let part of parts) {
        part = part.trim();
        const match = part.match(/^(PROXY|HTTPS|HTTP|SOCKS|SOCKS5)\s+([^\s]+)/i);
        if (match) {
          const type = match[1].toUpperCase();
          const hostPort = match[2];
          let scheme = 'http://';
          if (type === 'HTTPS') {
            scheme = 'https://';
          } else if (type === 'SOCKS' || type === 'SOCKS5') {
            scheme = 'socks5://';
          }
          return { success: true, proxyUrl: `${scheme}${hostPort}` };
        }
      }
    }
    return { success: false, message: '未检测到系统代理 (直连模式)' };
  } catch (e) {
    console.error('[Proxy Resolve] Failed to resolve system proxy:', e);
    return { success: false, message: `解析代理失败: ${e.message}` };
  }
}

// 辅助函数：执行网络测试探针
function performHttpTest(apiKey, proxyUrl) {
  return new Promise((resolve) => {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash?key=${apiKey}`;
      const options = {
        timeout: 8000 // 8s 超时
      };
      
      if (proxyUrl) {
        try {
          options.agent = new HttpsProxyAgent(proxyUrl);
        } catch (e) {
          return resolve({ success: false, errorType: 'PROXY_INVALID', message: `代理地址格式错误: ${e.message}` });
        }
      }

      const req = https.get(url, options, (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ success: true });
          } else {
            try {
              const parsed = JSON.parse(responseData);
              resolve({ 
                success: false, 
                errorType: 'API_ERROR',
                message: parsed.error?.message || `HTTP 错误码: ${res.statusCode}` 
              });
            } catch (e) {
              resolve({ success: false, errorType: 'API_ERROR', message: `HTTP 错误码: ${res.statusCode}` });
            }
          }
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, errorType: 'NETWORK_ERROR', message: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ success: false, errorType: 'TIMEOUT', message: '连接超时' });
      });
    } catch (err) {
      resolve({ success: false, errorType: 'UNKNOWN_ERROR', message: `网络测试发起异常: ${err.message}` });
    }
  });
}

// 辅助函数：网络错误友好描述转换
function translateNetworkError(msg) {
  if (!msg) return '未知网络错误';
  if (msg.includes('Proxy connection ended before receiving CONNECT response')) {
    return '代理连接被对方强行关闭（通常是端口错误或不支持 HTTP CONNECT 隧道。如果该代理端口为 443，请尝试改用 https 前缀）';
  }
  if (msg.includes('Client network socket disconnected before secure TLS connection was established')) {
    return '无法与代理服务器建立安全 TLS 连接（通常因为代理实际为普通 HTTP 代理，不支持 HTTPS 前缀，请尝试改为 http 前缀）';
  }
  if (msg.includes('ECONNREFUSED')) {
    return '代理服务器拒绝连接（请检查本地代理客户端如 Clash 是否已启动且端口号正确）';
  }
  if (msg.includes('ENOTFOUND')) {
    return '无法解析代理服务器的主机名（请检查网络设置或代理地址拼写）';
  }
  if (msg.includes('socket hang up')) {
    return '代理服务器连接挂起（可能是不支持的代理协议类型）';
  }
  return msg;
}

// 在 app ready 之后读取配置并注入环境变量
async function initializeEnv() {
  const settings = store.getSettings();
  if (settings.proxyUrl) {
    process.env.HTTPS_PROXY = settings.proxyUrl;
    console.log('[Env Init] Using user-defined proxy:', settings.proxyUrl);
  } else {
    // 95% 场景：零配置自动检测系统代理并注入 Node.js 进程环境
    try {
      const resolved = await resolveSystemProxyHelper();
      if (resolved.success && resolved.proxyUrl) {
        process.env.HTTPS_PROXY = resolved.proxyUrl;
        console.log('[Env Init] Automatically injected system proxy into Node:', resolved.proxyUrl);
      } else {
        console.log('[Env Init] No system proxy detected (DIRECT mode).');
      }
    } catch (e) {
      console.warn('[Env Init] Failed to resolve system proxy on startup:', e.message);
    }
  }

  if (settings.encryptedApiKey) {
    process.env.GEMINI_API_KEY = store.decryptKey(settings.encryptedApiKey);
  }
  if (settings.systemPrompt) {
    process.env.SYSTEM_PROMPT = settings.systemPrompt;
  }
  if (settings.geminiVoice) {
    process.env.GEMINI_VOICE = settings.geminiVoice;
  } else {
    process.env.GEMINI_VOICE = 'Aoede';
  }
}

function killProcessOnPort(port) {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    const cmd = `netstat -ano | findstr :${port}`;
    exec(cmd, (err, stdout) => {
      if (err || !stdout) {
        return resolve(false);
      }
      const lines = stdout.trim().split('\n');
      const pids = new Set();
      for (const line of lines) {
        if (line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const localAddress = parts[1];
          // 严格端口校验，规避包含 3000 但非 3000 端口的情况（例如 13000 等误杀）
          if (localAddress && localAddress.endsWith(`:${port}`)) {
            const pid = parts[parts.length - 1];
            if (pid && pid !== '0' && !isNaN(pid)) {
              pids.add(parseInt(pid, 10));
            }
          }
        }
      }
      if (pids.size === 0) {
        return resolve(false);
      }
      const currentPid = process.pid;
      const killPromises = Array.from(pids).map(pid => {
        if (pid === currentPid) return Promise.resolve();
        return new Promise(resKill => {
          console.log(`[Port Clean] Killing process ${pid} occupying port ${port}`);
          exec(`taskkill /F /PID ${pid}`, (killErr) => {
            if (killErr) {
              console.warn(`[Port Clean] Failed to kill process ${pid}:`, killErr.message);
            } else {
              console.log(`[Port Clean] Successfully killed process ${pid}`);
            }
            resKill();
          });
        });
      });
      Promise.all(killPromises).then(() => {
        setTimeout(() => resolve(true), 300);
      });
    });
  });
}

async function startServer() {
  const PORT = process.env.PORT || 3000;
  if (process.platform === 'win32') {
    try {
      await killProcessOnPort(PORT);
    } catch (e) {
      console.error('[Port Clean] Failed to auto-clean port 3000 on startup:', e);
    }
  }

  try {
    const { server } = require('../server.js');
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Server] Port ${PORT} is already in use. Assuming server is already running.`);
        showNotification('LiveScreen 提示', `检测到端口 ${PORT} 已被占用，请确保已关闭命令行中运行的网页端服务（如 Node/Nodemon 进程）。`);
      } else {
        console.error('[Server] Unexpected server error:', err);
      }
    });
    server.listen(PORT, () => {
      console.log(`Embedded LiveScreen Server running at http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error('Failed to start embedded server:', e);
  }
}

function createMainWindow() {
  const settings = store.getSettings();
  const bounds = settings.windowBounds || { width: 1200, height: 800 };

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false, // 无边框
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'windows', 'main-app.html'));

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-maximized-state', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-maximized-state', false);
  });

  mainWindow.on('close', () => {
    // 保存窗口位置
    const b = mainWindow.getBounds();
    store.saveSettings({ windowBounds: b });
    app.quit();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    // 检查 API Key
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      createSettingsWindow();
    }
  });

  mainWindow.on('minimize', (event) => {
    // 隐藏主窗口，显示迷你悬浮窗
    event.preventDefault();
    mainWindow.hide();
    if (miniWindow) {
      const { screen } = require('electron');
      const display = screen.getDisplayMatching(mainWindow.getBounds()) || screen.getPrimaryDisplay();
      const workArea = display.workArea;
      const miniBounds = miniWindow.getBounds();
      // 计算右下角坐标并预留 20px 边距
      const targetX = workArea.x + workArea.width - miniBounds.width - 20;
      const targetY = workArea.y + workArea.height - miniBounds.height - 20;
      miniWindow.setBounds({
        x: Math.round(targetX),
        y: Math.round(targetY),
        width: miniBounds.width,
        height: miniBounds.height
      });
      miniWindow.show();
    }
  });
}

function createMiniWindow() {
  miniWindow = new BrowserWindow({
    width: 380,
    height: 260,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: true,
    show: false, // 初始隐藏
    maximizable: false, // 禁用最大化
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  miniWindow.loadFile(path.join(__dirname, 'windows', 'mini.html'));

  miniWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      miniWindow.hide();
    }
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  // 检查主窗口是否可见，避免在主窗口隐藏时设置 parent 和 modal 导致层级死锁或隐身
  const isParentVisible = mainWindow && mainWindow.isVisible();

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 500,
    parent: isParentVisible ? mainWindow : undefined,
    modal: isParentVisible,
    frame: false, // 统一使用 Clay 风格的无边框设计
    resizable: false,
    maximizable: false, // 禁用最大化
    minimizable: false, // 禁用最小化
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'windows', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function registerIpcHandlers() {
  // 窗口基本控制
  ipcMain.on('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win === mainWindow) {
      mainWindow.minimize(); // 会触发 mainWindow.on('minimize')
    } else if (win) {
      win.minimize();
    }
  });

  ipcMain.on('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.on('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win === mainWindow || win === miniWindow) {
      app.quit();
    } else if (win) {
      win.close();
    }
  });

  ipcMain.on('restore-main', () => {
    if (miniWindow) {
      miniWindow.hide();
    }
    if (mainWindow) {
      mainWindow.show();
      mainWindow.restore();
    }
  });

  ipcMain.on('restore-main-maximized', () => {
    if (miniWindow) {
      miniWindow.hide();
    }
    if (mainWindow) {
      mainWindow.show();
      mainWindow.maximize();
    }
  });

  ipcMain.on('cmd-change-volume', (event, val) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cmd-change-volume', val);
    }
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.webContents.send('cmd-change-volume', val);
    }
  });

  ipcMain.on('open-settings', () => {
    createSettingsWindow();
  });

  // 迷你窗与主窗口命令转发
  ipcMain.on('cmd-start-screen', () => {
    if (mainWindow) {
      mainWindow.webContents.send('cmd-start-screen');
      showNotification('LiveScreen', '实时屏幕辅导已开启 📹');
    }
  });

  ipcMain.on('cmd-stop-screen', () => {
    lastFrame = null; // 清空残留帧，防止内存泄露
    if (mainWindow) {
      mainWindow.webContents.send('cmd-stop-screen');
      showNotification('LiveScreen', '屏幕共享已停止 ⏹');
    }
  });

  ipcMain.on('cmd-toggle-voice', () => {
    if (mainWindow) mainWindow.webContents.send('cmd-toggle-voice');
  });

  // 状态更新广播
  ipcMain.on('state-update', (_, state) => {
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.webContents.send('state-change', state);
    }
  });

  // 接收预览帧
  let lastFrame = null;
  ipcMain.on('preview-frame-update', (_, base64JPEG) => {
    lastFrame = base64JPEG;
  });

  // 1fps 转发屏幕预览帧给迷你窗，增加 isDestroyed 安全校验
  setInterval(() => {
    if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible() && lastFrame) {
      miniWindow.webContents.send('preview-frame', lastFrame);
    }
  }, 1000);

  // 设置获取与保存
  ipcMain.handle('get-settings', () => {
    return store.getSettingsForUI();
  });

  ipcMain.handle('get-decrypted-apikey', () => {
    const s = store.getSettings();
    return s.encryptedApiKey ? store.decryptKey(s.encryptedApiKey) : '';
  });

  ipcMain.handle('resolve-system-proxy', async () => {
    return resolveSystemProxyHelper();
  });

  ipcMain.handle('save-settings', (_, data) => {
    const updateData = { ...data };
    if (updateData.apiKey) {
      if (updateData.apiKey !== '••••••••') {
        updateData.encryptedApiKey = store.encryptKey(updateData.apiKey);
      }
      delete updateData.apiKey;
    }
    if (updateData.proxyUrl) {
      updateData.proxyUrl = updateData.proxyUrl.trim();
    }
    store.saveSettings(updateData);

    // 重新注入环境变量
    const settings = store.getSettings();
    if (settings.encryptedApiKey) {
      process.env.GEMINI_API_KEY = store.decryptKey(settings.encryptedApiKey);
    }
    if (settings.proxyUrl !== undefined) {
      process.env.HTTPS_PROXY = settings.proxyUrl;
    }
    if (settings.systemPrompt !== undefined) {
      process.env.SYSTEM_PROMPT = settings.systemPrompt;
    }
    if (settings.geminiVoice !== undefined) {
      process.env.GEMINI_VOICE = settings.geminiVoice;
    }

    return { success: true };
  });

  // 测试 API Key 与 代理地址的连通性探测
  ipcMain.handle('test-connection', async (_, data) => {
    const testApiKey = data.apiKey === '••••••••' ? store.decryptKey(store.getSettings().encryptedApiKey) : data.apiKey;
    let testProxy = data.proxyUrl ? data.proxyUrl.trim() : '';

    if (!testApiKey) {
      return { success: false, message: 'API Key 不能为空' };
    }

    // 1. 如果用户手动输入了代理地址，且以 https:// 开头
    if (testProxy && testProxy.toLowerCase().startsWith('https://')) {
      console.log(`[Test Connection] Testing with HTTPS proxy: ${testProxy}`);
      const res = await performHttpTest(testApiKey, testProxy);
      if (res.success) {
        return { success: true };
      }

      // 检查是否为 TLS 握手层相关的错误
      const isTlsError = res.message && (
        res.message.includes('Proxy connection ended before receiving CONNECT response') ||
        res.message.includes('Client network socket disconnected before secure TLS connection was established') ||
        res.message.includes('socket hang up')
      );

      if (isTlsError) {
        // 尝试自动回退，将 https:// 转换为 http://
        const fallbackProxy = 'http://' + testProxy.substring(8);
        console.log(`[Test Connection] HTTPS proxy failed with TLS handshake error. Trying fallback HTTP proxy: ${fallbackProxy}`);
        const fallbackRes = await performHttpTest(testApiKey, fallbackProxy);
        if (fallbackRes.success) {
          return {
            success: true,
            autoCorrected: true,
            correctedProxyUrl: fallbackProxy,
            message: '检测到您的代理在 443 端口仅支持普通 HTTP 代理协议，已自动为您修正代理前缀为 http://。'
          };
        }
      }
      
      // 如果回退也失败了，返回最初的错误信息
      return { success: false, message: translateNetworkError(res.message) };
    }

    // 2. 如果用户手动输入了代理地址，且非 https:// 开头
    if (testProxy) {
      console.log(`[Test Connection] Testing with proxy: ${testProxy}`);
      const res = await performHttpTest(testApiKey, testProxy);
      if (res.success) {
        return { success: true };
      }
      return { success: false, message: translateNetworkError(res.message) };
    }

    // 3. 用户没有手动配置代理（留空）
    console.log('[Test Connection] Testing direct connection (TUN mode)...');
    const directRes = await performHttpTest(testApiKey, null);
    if (directRes.success) {
      return { success: true, mode: 'direct' };
    }

    // 直连失败，尝试探测系统代理作为备用
    console.log('[Test Connection] Direct connection failed. Trying to resolve system proxy...');
    const resolved = await resolveSystemProxyHelper();
    if (resolved.success && resolved.proxyUrl) {
      console.log(`[Test Connection] System proxy detected: ${resolved.proxyUrl}. Testing connection through it...`);
      const sysRes = await performHttpTest(testApiKey, resolved.proxyUrl);
      if (sysRes.success) {
        return {
          success: true,
          autoDetected: true,
          detectedProxyUrl: resolved.proxyUrl,
          message: `直连测试失败，但已自动探测到系统代理 ${resolved.proxyUrl} 连线成功。`
        };
      }
    }

    // 如果所有尝试都失败了，返回直连错误信息
    return { success: false, message: `直连失败且未检测到可用代理: ${translateNetworkError(directRes.message)}` };
  });
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.whenReady().then(async () => {
  await initializeEnv();
  startServer();
  registerIpcHandlers();
  createTray(); // 创建原生系统托盘

  // 注册全局快捷键 Alt+Space，用于在主窗口与迷你窗之间快速切换
  globalShortcut.register('Alt+Space', () => {
    if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) {
      miniWindow.hide();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.restore();
      }
    } else if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.minimize(); // 会触发最小化拦截隐藏主窗口并显示迷你窗
    } else {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.restore();
      }
    }
  });

  // 拦截渲染进程的 getDisplayMedia 请求，自动授权首个屏幕源，解决 Electron 默认权限拦截问题
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      const primarySource = sources.find(s => s.id.startsWith('screen:')) || sources[0];
      if (primarySource) {
        callback({ video: primarySource });
      } else {
        callback({ error: 'No video sources found' });
      }
    }).catch(err => {
      console.error('Failed to get sources for display media request:', err);
      callback({ error: err.message });
    });
  });

  createMainWindow();
  createMiniWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createMiniWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll(); // 注销所有全局快捷键，防范内存泄露与物理锁占用
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

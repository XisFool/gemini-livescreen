// Global Shared AudioContext to prevent audio hardware conflicts
window.getSharedAudioContext = function() {
  if (!window.SharedAudioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    window.SharedAudioContext = new AudioContextClass({ sampleRate: 24000 });
    if (window.MediaRegistry) window.MediaRegistry.registerContext(window.SharedAudioContext);
  }
  return window.SharedAudioContext;
};

// Ultra-low latency PCM Audio Player for Gemini Live Voice output
class AudioPlayer {
  constructor() {
    this.audioContext = null;
    this.nextPlayTime = 0;
    this.activeSources = [];
    this.gainNode = null;
    this.volume = parseFloat(localStorage.getItem('gemini-volume') || '1.0');
  }

  init() {
    if (this.audioContext) return;
    this.audioContext = window.getSharedAudioContext();
    this.nextPlayTime = 0;
    
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.setValueAtTime(this.volume, this.audioContext.currentTime);
    this.gainNode.connect(this.audioContext.destination);
  }

  setVolume(val) {
    this.volume = val;
    localStorage.setItem('gemini-volume', val);
    if (this.gainNode && this.audioContext) {
      this.gainNode.gain.setValueAtTime(val, this.audioContext.currentTime);
    }
  }

  playChunk(base64Data) {
    this.init();
    
    // Resume context if suspended
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    try {
      // Decode Base64 to ArrayBuffer
      const binaryString = window.atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert Int16 buffer to Float32 samples [-1.0, 1.0]
      const int16Samples = new Int16Array(bytes.buffer);
      const float32Samples = new Float32Array(int16Samples.length);
      for (let i = 0; i < int16Samples.length; i++) {
        float32Samples[i] = int16Samples[i] / 32768.0;
      }

      // Allocate buffer & fill
      const audioBuffer = this.audioContext.createBuffer(1, float32Samples.length, 24000);
      audioBuffer.getChannelData(0).set(float32Samples);

      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.gainNode);

      // Precise time alignment scheduling to avoid stutter and gap clicks
      const currentTime = this.audioContext.currentTime;
      if (this.nextPlayTime < currentTime) {
        this.nextPlayTime = currentTime;
      }
      
      source.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;

      // Track playing source node for barge-in interruptions
      this.activeSources.push(source);
      source.onended = () => {
        const index = this.activeSources.indexOf(source);
        if (index > -1) {
          this.activeSources.splice(index, 1);
        }
      };
    } catch (e) {
      console.error("Failed to play audio chunk:", e);
    }
  }

  stop() {
    // Barge-in: stop all playing source nodes instantly without closing the context
    const sourcesToStop = [...this.activeSources];
    this.activeSources = []; // Clear array first to prevent splice from index-drifting
    sourcesToStop.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    this.nextPlayTime = 0;

    // Barge-in 视觉微交互：将当前的 AI 回复气泡置灰渐变
    if (sourcesToStop.length > 0) {
      const aiBubbles = document.querySelectorAll('.chat-message.ai');
      if (aiBubbles.length > 0) {
        const latestAi = aiBubbles[aiBubbles.length - 1];
        if (latestAi && !latestAi.classList.contains('interrupted')) {
          latestAi.classList.add('interrupted');
          const content = latestAi.querySelector('.message-content');
          if (content) {
            content.innerHTML += ' <span style="font-size: 11px; opacity: 0.5; font-style: italic; white-space: nowrap;">(已打断)</span>';
          }
        }
      }
    }
  }
}

// Global Media registry to clean up media hardware indicators (LED lights) robustly
window.MediaRegistry = {
  activeStreams: new Set(),
  activeContexts: new Set(),
  registerStream(stream) {
    if (stream) {
      this.activeStreams.add(stream);
      console.log(`[MediaRegistry] Registered stream (Total: ${this.activeStreams.size})`);
    }
  },
  unregisterStream(stream) {
    if (stream) {
      this.activeStreams.delete(stream);
      console.log(`[MediaRegistry] Unregistered stream (Total: ${this.activeStreams.size})`);
    }
  },
  registerContext(ctx) {
    if (ctx) {
      this.activeContexts.add(ctx);
      console.log(`[MediaRegistry] Registered AudioContext (Total: ${this.activeContexts.size})`);
    }
  },
  cleanAll() {
    console.log("[MediaRegistry] Force cleaning all active media hardware resources...");
    this.activeStreams.forEach(stream => {
      try {
        stream.getTracks().forEach(track => {
          track.stop();
          console.log(`[MediaRegistry] Stopped stream track: ${track.label}`);
        });
      } catch (e) {
        console.error(e);
      }
    });
    this.activeStreams.clear();

    this.activeContexts.forEach(ctx => {
      try {
        if (ctx.state !== 'closed') {
          ctx.close();
          console.log("[MediaRegistry] Closed AudioContext.");
        }
      } catch (e) {
        console.error(e);
      }
    });
    this.activeContexts.clear();
  }
};

window.addEventListener('beforeunload', () => {
  window.MediaRegistry.cleanAll();
});

// DOM Elements
const wsStatusDot = document.getElementById('ws-status-dot');
const wsStatusText = document.getElementById('ws-status-text');
const btnStartShare = document.getElementById('btn-start-share');
const btnStopShare = document.getElementById('btn-stop-share');
const screenVideo = document.getElementById('screen-video');
const screenCanvas = document.getElementById('screen-canvas');
const screenPlaceholder = document.getElementById('screen-placeholder');
const chatHistory = document.getElementById('chat-history');
const btnVoice = document.getElementById('btn-voice');
const inputMessage = document.getElementById('input-message');
const btnSend = document.getElementById('btn-send');
const btnClearChat = document.getElementById('btn-clear-chat');
const voiceHint = document.getElementById('voice-hint');

// Status Bar Elements
const dotFps = document.getElementById('dot-fps');
const txtFps = document.getElementById('txt-fps');
const dotAudio = document.getElementById('dot-audio');
const txtAudio = document.getElementById('txt-audio');

// App Variables
let ws = null;
let screenCapture = null;
let audioCapture = null;
let audioPlayer = null;
let currentAiMessageElement = null; // Reference to the active AI streaming message bubble
let isStreaming = false;
let currentUserMessageElement = null; // Reference to the active user streaming message bubble
let isUserStreaming = false;
let voiceActiveMode = 'idle'; // 'idle' | 'push-to-talk' | 'toggle-on'
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

// Initialize components
document.addEventListener('DOMContentLoaded', () => {
  screenCapture = new ScreenCapture(screenVideo, screenCanvas);
  audioPlayer = new AudioPlayer();
  
  // Set up audio capture handler
  audioCapture = new AudioCapture((base64PCM) => {
    sendWebSocketMessage('audio', { data: base64PCM });
  });

  // Attach Event Listeners
  btnStartShare.addEventListener('click', startScreenShare);
  btnStopShare.addEventListener('click', stopScreenShare);
  btnSend.addEventListener('click', handleTextSend);
  inputMessage.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleTextSend();
  });
  btnClearChat.addEventListener('click', clearChat);

  // Setup Voice Button (supports both Tap-to-toggle and Push-to-talk)
  setupVoiceButtonEvents();
  
  // Clean up when screen share stops natively
  screenCapture.onStop(() => {
    updateScreenUI(false);
  });

  // Token Saver: Auto pause 1fps screen streaming when tab goes to background
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (screenCapture && screenCapture.isCapturing) {
        const track = screenCapture.stream?.getVideoTracks()[0];
        const settings = track?.getSettings();
        // 仅当用户共享的是浏览器标签页(browser)时，退到后台才挂起，共享整个屏幕/应用窗口时继续捕获
        if (settings && settings.displaySurface === 'browser') {
          console.log("[Token Saver] Tab went to background and sharing a browser tab. Pausing screen frame loop to save API tokens...");
          screenCapture.pauseFrameLoop();
          txtFps.textContent = '帧率: 0 fps (后台挂起)';
          dotFps.classList.remove('active');
        } else {
          console.log("[Token Saver] Tab went to background but sharing monitor/window. Continuing screen capture.");
        }
      }
    } else {
      if (screenCapture && screenCapture.isCapturing) {
        console.log("[Token Saver] Tab returned to foreground. Resuming screen frame loop...");
        screenCapture.resumeFrameLoop(1, (base64JPEG) => {
          sendWebSocketMessage('frame', { data: base64JPEG });
        });
        txtFps.textContent = '帧率: 1 fps';
        dotFps.classList.add('active');
      }
    }
  });

  // 音量控制逻辑绑定
  const volumeSlider = document.getElementById('volume-slider');
  const btnVolumeMute = document.getElementById('btn-volume-mute');
  let preMuteVolume = 1.0;

  function updateVolumeIcon(val) {
    if (!btnVolumeMute) return;
    if (val === 0) {
      btnVolumeMute.textContent = '🔇';
    } else if (val < 0.5) {
      btnVolumeMute.textContent = '🔈';
    } else {
      btnVolumeMute.textContent = '🔊';
    }
  }

  if (volumeSlider && btnVolumeMute) {
    const savedVol = localStorage.getItem('gemini-volume') || '1.0';
    volumeSlider.value = savedVol;
    audioPlayer.setVolume(parseFloat(savedVol));
    updateVolumeIcon(parseFloat(savedVol));

    volumeSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      audioPlayer.setVolume(val);
      updateVolumeIcon(val);
      if (window.electronAPI) {
        window.electronAPI.changeVolume(val);
      }
    });

    btnVolumeMute.addEventListener('click', () => {
      const val = parseFloat(volumeSlider.value);
      if (val > 0) {
        preMuteVolume = val;
        volumeSlider.value = 0;
        audioPlayer.setVolume(0);
        updateVolumeIcon(0);
        if (window.electronAPI) {
          window.electronAPI.changeVolume(0);
        }
      } else {
        volumeSlider.value = preMuteVolume;
        audioPlayer.setVolume(preMuteVolume);
        updateVolumeIcon(preMuteVolume);
        if (window.electronAPI) {
          window.electronAPI.changeVolume(preMuteVolume);
        }
      }
    });
  }

  if (window.electronAPI) {
    window.electronAPI.onChangeVolume((val) => {
      if (volumeSlider) {
        volumeSlider.value = val;
      }
      audioPlayer.setVolume(val);
      updateVolumeIcon(val);
    });
  }
});

// WebSocket Connection Management
function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  updateWsStatus('connecting', '正在连接服务器...');
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    reconnectAttempts = 0;
    updateWsStatus('connected', '已连接');
    enableInputArea(true);
    appendSystemMessage("服务器连接已建立，Gemini 实时通道已就绪。");
    // 如果屏幕共享早已启动，连接成功后立刻开始推送帧
    if (screenCapture && screenCapture.isCapturing) {
      startScreenFrameLoop();
    }
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleIncomingMessage(message);
    } catch (e) {
      console.error("Error parsing WebSocket message:", e);
    }
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    updateWsStatus('disconnected', '连接错误');
  };

  ws.onclose = () => {
    updateWsStatus('disconnected', '连接已断开');
    enableInputArea(false);
    
    // Stop recordings and screen capture if server goes down
    if (screenCapture.isCapturing) {
      screenCapture.stop();
      updateScreenUI(false);
    }
    stopAudioRecording();

    // Auto-reconnect logic
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      appendSystemMessage(`连接已断开。尝试重新连接 (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
      setTimeout(connectWebSocket, 3000);
    } else {
      appendSystemMessage("无法连接到后端服务器。请确保后端 server.js 正在运行并刷新页面重试。");
    }
  };
}

// Smooth scroll helper for chat history to prevent visual layout jumps
function scrollToBottom() {
  chatHistory.scrollTo({
    top: chatHistory.scrollHeight,
    behavior: 'smooth'
  });
}

function sendWebSocketMessage(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  } else {
    console.warn("WebSocket is not open. Unable to send:", type);
  }
}

// Handle Incoming WebSocket Messages
function handleIncomingMessage(message) {
  switch (message.type) {
    case 'status':
      updateWsStatus('connected', message.payload.message);
      break;

    case 'audio_chunk':
      if (audioPlayer) {
        audioPlayer.playChunk(message.payload.data);
      }
      break;

    case 'user_transcription':
      // Streaming character output from user's voice input
      if (!isUserStreaming || !currentUserMessageElement) {
        // Start a new user message bubble
        currentUserMessageElement = appendMessage('user', '', true);
        isUserStreaming = true;
      }
      
      const userContentSpan = currentUserMessageElement.querySelector('.message-content');
      // Append raw markdown text but render it
      userContentSpan.setAttribute('data-raw-content', (userContentSpan.getAttribute('data-raw-content') || '') + message.payload.content);
      userContentSpan.innerHTML = renderMarkdown(userContentSpan.getAttribute('data-raw-content'));
      
      // Auto scroll chat history
      scrollToBottom();

      if (message.payload.finished) {
        // Remove typing indicator if we had one
        const indicator = currentUserMessageElement.querySelector('.typing-indicator');
        if (indicator) indicator.remove();
        
        isUserStreaming = false;
        currentUserMessageElement = null;
        console.log("User voice transcription complete.");
      }
      break;

    case 'text_chunk':
      // Streaming character output from Gemini
      if (!isStreaming || !currentAiMessageElement) {
        // Start a new AI message bubble
        currentAiMessageElement = appendMessage('ai', '', true);
        isStreaming = true;
      }
      
      const contentSpan = currentAiMessageElement.querySelector('.message-content');
      // Append raw markdown text but render it
      contentSpan.setAttribute('data-raw-content', (contentSpan.getAttribute('data-raw-content') || '') + message.payload.content);
      contentSpan.innerHTML = renderMarkdown(contentSpan.getAttribute('data-raw-content'));
      
      // Auto scroll chat history
      scrollToBottom();
      break;

    case 'turn_complete':
      // Gemini has finished its response for the current turn
      if (isStreaming && currentAiMessageElement) {
        // Remove typing indicator if we had one
        const indicator = currentAiMessageElement.querySelector('.typing-indicator');
        if (indicator) indicator.remove();
        
        isStreaming = false;
        currentAiMessageElement = null;
        console.log("Gemini reply turn complete.");
      }
      break;

    case 'error':
      appendSystemMessage(`错误: ${message.payload.message}`);
      console.error("Server-side error:", message.payload.message);
      break;

    default:
      console.warn("Unhandled message type:", message.type);
  }
}

// Screen Sharing Logic
async function startScreenShare() {
  try {
    // 1. Establish WebSocket first if not already connected
    connectWebSocket();

    // 2. Start screen capture
    const success = await screenCapture.start();
    if (success) {
      updateScreenUI(true);
      // 检查连接是否已就绪，若已就绪则立即开始发送，否则等待 onopen 触发
      if (ws && ws.readyState === WebSocket.OPEN) {
        startScreenFrameLoop();
      } else {
        appendSystemMessage("屏幕共享已就绪，等待服务器通道连接...");
      }
    }
  } catch (error) {
    appendSystemMessage(`屏幕共享启动失败: ${error.message || error}`);
  }
}

function startScreenFrameLoop() {
  if (screenCapture && screenCapture.isCapturing) {
    const fps = 1;
    screenCapture.resumeFrameLoop(fps, (base64JPEG) => {
      sendWebSocketMessage('frame', { data: base64JPEG });
    });
    txtFps.textContent = `帧率: ${fps} fps`;
    dotFps.classList.add('active');
    appendSystemMessage(`屏幕画面传输通道已激活 (${fps} fps)。`);
  }
}

function stopScreenShare() {
  screenCapture.stop();
  updateScreenUI(false);
  appendSystemMessage("屏幕共享已停止。");
}

function updateScreenUI(isSharing) {
  if (isSharing) {
    screenPlaceholder.style.display = 'none';
    btnStartShare.disabled = true;
    btnStopShare.disabled = false;
    
    // Update FPS bar indicator
    dotFps.classList.add('active');
    txtFps.textContent = '帧率: 1 fps';
  } else {
    screenPlaceholder.style.display = 'flex';
    btnStartShare.disabled = false;
    btnStopShare.disabled = true;
    
    // Update FPS bar indicator
    dotFps.classList.remove('active');
    txtFps.textContent = '帧率: 0 fps';
  }
}

// Voice Button Event Handlers (Supports both Hold-to-Talk and Tap-to-Toggle)
function setupVoiceButtonEvents() {
  let timer = null;
  let isHold = false;

  const startVoice = async (e) => {
    e.preventDefault();
    if (voiceActiveMode === 'toggle-on') return; // If already toggled on, ignore
    
    isHold = false;
    timer = setTimeout(() => {
      // If held for more than 350ms, trigger push-to-talk mode
      isHold = true;
      voiceActiveMode = 'push-to-talk';
      startAudioRecording();
    }, 350);
  };

  const endVoice = (e) => {
    e.preventDefault();
    clearTimeout(timer);
    
    if (isHold && voiceActiveMode === 'push-to-talk') {
      // Release of push-to-talk
      voiceActiveMode = 'idle';
      stopAudioRecording();
    } else if (!isHold) {
      // Simple quick tap -> Toggle state
      if (voiceActiveMode === 'toggle-on') {
        voiceActiveMode = 'idle';
        stopAudioRecording();
      } else {
        voiceActiveMode = 'toggle-on';
        startAudioRecording();
      }
    }
  };

  // Attach mouse events
  btnVoice.addEventListener('mousedown', startVoice);
  btnVoice.addEventListener('mouseup', endVoice);
  btnVoice.addEventListener('mouseleave', () => {
    clearTimeout(timer);
    if (voiceActiveMode === 'push-to-talk') {
      voiceActiveMode = 'idle';
      stopAudioRecording();
    }
  });

  // Attach mobile touch events
  btnVoice.addEventListener('touchstart', startVoice);
  btnVoice.addEventListener('touchend', endVoice);
}

async function startAudioRecording() {
  try {
    // Interrupt AI voice if it's currently playing
    if (audioPlayer) {
      audioPlayer.stop();
    }

    connectWebSocket(); // Ensure connection is active
    
    const success = await audioCapture.start();
    if (success) {
      btnVoice.classList.add('recording');
      
      dotAudio.classList.add('active');
      dotAudio.style.backgroundColor = 'var(--brand-pink)';
      txtAudio.textContent = '麦克风: 录音中';

      if (voiceActiveMode === 'push-to-talk') {
        voiceHint.textContent = '语音状态：按住说话中...';
      } else {
        voiceHint.textContent = '语音状态：长开通话中... 点击麦克风关闭。';
      }
    }
  } catch (error) {
    appendSystemMessage(`麦克风启动失败: ${error.message || error}`);
    voiceActiveMode = 'idle';
    stopAudioRecording();
  }
}

function stopAudioRecording() {
  audioCapture.stop();
  btnVoice.classList.remove('recording');
  
  dotAudio.classList.remove('active');
  dotAudio.style.backgroundColor = '';
  txtAudio.textContent = '麦克风: 未开启';
  
  voiceHint.textContent = '语音状态：关闭。可按住麦克风图标或点击它以开启。';
}

// Handle Text Communication
function handleTextSend() {
  const text = inputMessage.value.trim();
  if (!text) return;

  // Interrupt AI voice on sending text
  if (audioPlayer) {
    audioPlayer.stop();
  }

  // Make sure WS is connected
  connectWebSocket();

  // Send message through WebSocket
  sendWebSocketMessage('text', { content: text });

  // Render message on client screen
  appendMessage('user', text);

  // Clear input
  inputMessage.value = '';
}

// UI State Updates
function updateWsStatus(status, text) {
  wsStatusDot.className = 'status-dot';
  wsStatusDot.classList.add(status);
  wsStatusText.textContent = text;
}

function enableInputArea(enabled) {
  inputMessage.disabled = !enabled;
  btnSend.disabled = !enabled;
  if (enabled) {
    inputMessage.placeholder = "输入问题或长按麦克风说话...";
  } else {
    inputMessage.placeholder = "连接断开，无法输入...";
  }
}

// Chat UI Rendering Helpers
function appendMessage(role, content, isStreaming = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${role}`;
  
  const senderDiv = document.createElement('div');
  senderDiv.className = 'message-sender';
  senderDiv.textContent = role === 'user' ? 'YOU' : 'GEMINI TUTOR';
  
  const contentSpan = document.createElement('span');
  contentSpan.className = 'message-content';
  
  messageDiv.appendChild(senderDiv);
  messageDiv.appendChild(contentSpan);

  if (isStreaming) {
    contentSpan.setAttribute('data-raw-content', content);
    contentSpan.innerHTML = renderMarkdown(content);
    
    // Add typing indicator
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    messageDiv.appendChild(indicator);
  } else {
    contentSpan.innerHTML = renderMarkdown(content);
  }

  chatHistory.appendChild(messageDiv);
  scrollToBottom();

  return messageDiv;
}

function appendSystemMessage(content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message system';
  
  const contentSpan = document.createElement('span');
  contentSpan.className = 'message-content';
  contentSpan.textContent = content;
  
  messageDiv.appendChild(contentSpan);
  chatHistory.appendChild(messageDiv);
  scrollToBottom();
}

function clearChat() {
  chatHistory.innerHTML = `
    <div class="chat-message system">
      <div class="message-content">对话历史已清空。重新与 Gemini 开启你的辅导旅程吧！</div>
    </div>
  `;
  isStreaming = false;
  currentAiMessageElement = null;
  isUserStreaming = false;
  currentUserMessageElement = null;
}

// Ultra-light Vanilla Markdown Parser
function renderMarkdown(text) {
  if (!text) return '';
  
  // Escape HTML tags to prevent XSS
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  
  // Parse triple code blocks: ```lang ... ```
  html = html.replace(/```(?:[a-zA-Z0-9]+)?\n([\s\S]+?)\n```/g, (match, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });
  
  // Parse inline code: `code`
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  
  // Parse bold text: **bold**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Parse list items
  html = html.replace(/^\s*-\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');
  // Combine adjacent <ul> tags
  html = html.replace(/<\/ul>\s*<ul>/g, '');
  
  // Convert newlines to breaks outside pre tags
  const parts = html.split(/(<pre>[\s\S]*?<\/pre>)/g);
  html = parts.map(part => {
    if (part.startsWith('<pre>')) return part;
    return part.replace(/\n/g, '<br>');
  }).join('');
  
  return html;
}

// Expose application controls globally for Electron IPC integration
window.AppControl = {
  toggleVoice: () => {
    if (voiceActiveMode === 'toggle-on') {
      voiceActiveMode = 'idle';
      stopAudioRecording();
    } else {
      voiceActiveMode = 'toggle-on';
      startAudioRecording();
    }
  },
  startScreenShare: () => {
    startScreenShare();
  },
  stopScreenShare: () => {
    stopScreenShare();
  }
};

// Monkey Patch WebSocket to support HTTPS proxy dynamically for Gemini Live API
const wsModule = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

const OriginalWebSocket = wsModule.WebSocket;
let currentProxyUrl = null;
let currentAgent = null;

class ProxyWebSocket extends OriginalWebSocket {
  constructor(address, protocols, options) {
    let opts = options || {};
    if (protocols && typeof protocols === 'object' && !Array.isArray(protocols)) {
      opts = protocols;
      protocols = undefined;
    }
    
    const addressStr = String(address);
    if (addressStr.includes('googleapis.com')) {
      // 动态获取最新的代理配置
      const latestProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
      if (latestProxy) {
        if (latestProxy !== currentProxyUrl) {
          console.log(`[Proxy WebSocket] Updating dynamic proxy agent to: ${latestProxy}`);
          try {
            currentAgent = new HttpsProxyAgent(latestProxy);
            currentProxyUrl = latestProxy;
          } catch (err) {
            console.error('[Proxy WebSocket] Failed to parse proxy URL:', err);
            currentAgent = null;
            currentProxyUrl = null;
          }
        }
        if (currentAgent) {
          opts = { ...opts, agent: currentAgent };
          console.log(`[Proxy WebSocket] Routing Gemini Live connection through agent: ${currentProxyUrl}`);
        }
      } else {
        // 如果清空了代理，则重置缓存
        currentProxyUrl = null;
        currentAgent = null;
      }
    }
    super(address, protocols, opts);
  }
}

wsModule.WebSocket = ProxyWebSocket;
if (typeof globalThis !== 'undefined') {
  globalThis.WebSocket = ProxyWebSocket;
}

const express = require('express');
const http = require('http');
const WebSocket = wsModule; // Keep references aligned
const { GoogleGenAI } = require('@google/genai');


const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

// Port configuration
const PORT = process.env.PORT || 3000;

// Host static files from 'public' directory
const publicDir = require('path').join(
  (() => { try { return require('electron').app.getAppPath(); } catch(e) { return __dirname; } })(),
  'public'
);
app.use(express.static(publicDir));

// Check for API key
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("WARNING: GEMINI_API_KEY is not set in the environment or .env file.");
  console.warn("Please create a .env file with GEMINI_API_KEY=your_key or set it in your environment.");
}

// Connection initialized

wss.on('connection', async (ws) => {
  console.log("Client connected via WebSocket. Initializing Gemini Live Session...");
  
  // 心跳探活机制，检测并防范网络抖动下的半连接资源占用
  let isAlive = true;
  ws.on('pong', () => {
    isAlive = true;
  });

  const pingInterval = setInterval(() => {
    if (isAlive === false) {
      console.log("[Heartbeat] Client heartbeat lost. Terminating socket connection...");
      clearInterval(pingInterval);
      ws.terminate();
      return;
    }
    isAlive = false;
    ws.ping();
  }, 20000);

  ws.send(JSON.stringify({ type: 'status', payload: { message: 'Connecting to Gemini Live API...' } }));

  if (!process.env.GEMINI_API_KEY) {
    ws.send(JSON.stringify({ 
      type: 'error', 
      payload: { message: 'GEMINI_API_KEY is missing on the server. Please check your .env file.' } 
    }));
    ws.close();
    return;
  }

  let session;
  let pendingQueue = [];
  let isFlushing = false;

  async function flushQueue() {
    if (isFlushing) return;
    isFlushing = true;
    console.log(`[Queue] Gemini session ready. Flushing ${pendingQueue.length} buffered message(s)...`);
    while (pendingQueue.length > 0) {
      const rawData = pendingQueue.shift();
      try {
        await sendToSession(rawData);
      } catch (e) {
        console.error("[Queue] Error flushing data:", e);
      }
    }
    isFlushing = false;
  }

  async function sendToSession(data) {
    if (!session) return;
    const message = JSON.parse(data);

    switch (message.type) {
      case 'text':
        console.log("Received text from client:", message.payload.content);
        await session.sendClientContent({
          turns: [{
            role: 'user',
            parts: [{ text: message.payload.content }]
          }],
          turnComplete: true
        });
        break;

      case 'audio':
        session.sendRealtimeInput({
          audio: {
            mimeType: 'audio/pcm;rate=16000',
            data: message.payload.data
          }
        });
        break;

      case 'frame':
        session.sendRealtimeInput({
          video: {
            mimeType: 'image/jpeg',
            data: message.payload.data
          }
        });
        break;

      default:
        console.warn("Unknown message type received:", message.type);
    }
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const modelName = 'gemini-3.1-flash-live-preview';

  try {
    session = await ai.live.connect({
      model: modelName,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: process.env.GEMINI_VOICE || 'Aoede'
            }
          }
        },
        systemInstruction: {
          parts: [{
            text: process.env.SYSTEM_PROMPT ||
              "You are a helpful and intuitive live screen tutor. You are receiving a real-time stream of the user's screen (roughly 1 frame per second) and user audio/text. Please observe the user's screen content and help them solve tasks, answer questions, write code, or explain concepts dynamically. Be concise and friendly. You reply in natural spoken dialogue. Your speech will be automatically transcribed for the user."
          }]
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {}
      },
      callbacks: {
        onmessage: (message) => {
          // Check for input/output transcriptions
          if (message.serverContent?.inputTranscription) {
            const text = message.serverContent.inputTranscription.text;
            if (text) {
              ws.send(JSON.stringify({
                type: 'user_transcription',
                payload: { 
                  content: text, 
                  finished: message.serverContent.inputTranscription.finished 
                }
              }));
            }
          }
          if (message.serverContent?.outputTranscription) {
            const text = message.serverContent.outputTranscription.text;
            if (text) {
              ws.send(JSON.stringify({
                type: 'text_chunk',
                payload: { content: text }
              }));
            }
          }

          // Check if there are content updates
          if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.text) {
                ws.send(JSON.stringify({
                  type: 'text_chunk',
                  payload: { content: part.text }
                }));
              }
              if (part.inlineData) {
                ws.send(JSON.stringify({
                  type: 'audio_chunk',
                  payload: { 
                    mimeType: part.inlineData.mimeType, 
                    data: part.inlineData.data 
                  }
                }));
              }
            }
          }
          if (message.serverContent?.turnComplete) {
            ws.send(JSON.stringify({ type: 'turn_complete' }));
          }
        },
        onerror: (err) => {
          console.error("Error in Gemini live session:", err);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'error',
              payload: { message: `Gemini Session error: ${err.message || err}` }
            }));
          }
        },
        onclose: (event) => {
          console.log("Gemini connection closed:", event.reason);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'error',
              payload: { message: `Gemini Session closed: ${event.reason || 'Unknown reason'}` }
            }));
            ws.close();
          }
        }
      }
    });

    console.log(`Gemini Live Session initialized successfully using model ${modelName}.`);
    ws.send(JSON.stringify({ type: 'status', payload: { message: 'Gemini Live Session Ready' } }));

    // 消费暂存的消息队列（采用串行安全消费）
    await flushQueue();

  } catch (error) {
    console.error("Failed to connect to Gemini Live API:", error);
    ws.send(JSON.stringify({ 
      type: 'error', 
      payload: { message: `Failed to initialize Gemini Live Session: ${error.message}. Ensure your API key is valid and the model ${modelName} is available.` } 
    }));
    ws.close();
    return;
  }

  // Handle incoming messages from client WebSocket
  ws.on('message', async (data) => {
    try {
      if (!session || isFlushing) {
        pendingQueue.push(data);
        console.log(`[Queue] Buffered client message type: ${JSON.parse(data).type}`);
        if (session) {
          await flushQueue();
        }
        return;
      }
      await sendToSession(data);
    } catch (err) {
      console.error("Error processing client message:", err);
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: `Failed to process message: ${err.message}` }
      }));
    }
  });

  ws.on('close', () => {
    console.log("Client disconnected. Cleaning up Gemini Session...");
    clearInterval(pingInterval); // 清理探活定时器
    isFlushing = false;          // 重置锁，防止状态残留阻塞后续连接
    pendingQueue = [];            // 清空未消费队列
    if (session) {
      try {
        session.close();
      } catch (err) {
        console.error("Error closing Gemini session:", err);
      }
      session = null;
    }
  });
});

// Upgrade HTTP connection to WS
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Start the server
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`  LiveScreen Server running at http://localhost:${PORT}`);
    console.log(`==================================================`);
  });
}
module.exports = { server, PORT };

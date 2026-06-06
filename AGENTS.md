> 最后更新：2026-06-06

# AGENTS.md

## Tech Stack
- **Language:** JavaScript (ES6+), Node.js (>=20.0.0)
- **Backend:** Node.js, Express 4.x, `ws` (WebSocket) 8.x, `@google/genai` (Google Gen AI SDK v2.8.0), `dotenv`, `https-proxy-agent`
- **Frontend:** Vanilla HTML5, Vanilla CSS3 (Clay.com 设计风格), Vanilla JS
- **Desktop:** Electron 42.x, electron-builder 26.x
- **API Model:** `gemini-3.1-flash-live-preview`
- **Key Directories & Files:**
  - `server.js` — 后端骨架：静态托管、WebSocket 升级与安全路由转发，内置 Google API 代理补丁（支持动态重载）与 session 管道管理
  - `electron/main.js` — Electron 主进程：控制窗口生命周期、托盘系统、全局快捷键映射、及 `setDisplayMediaRequestHandler` 等安全拦截
  - `electron/preload.js` — 安全桥接：contextBridge 安全暴露 IPC APIs（连通性测试、窗口操作、命令转发）
  - `electron/store.js` — 设置持久化：基于 fs 与 safeStorage 混合加密的设置安全管理器
  - `electron/windows/` — 桌面端专用页面：
    - `main-app.html` — 主窗口（支持自定义标题栏、自适应高度及状态同步监听）
    - `mini.html` — 悬浮小窗（支持 Container Queries 极窄自适应和 1fps 快照预览）
    - `settings.html` — 设置管理面板（包含 API Key 遮罩、代理、System Prompt 以及“一键测试连接”能力）
  - `public/` — 网页端 Demo 原版：
    - `index.html` — 原版网页主框架
    - `style.css` — 视觉核心样式（已被重构注入 3D 内阴影高光粘土质感和磨砂亚克力设计）
    - `app.js` — 逻辑总控（新增加了 window.AppControl 对外解耦接口与 MediaRegistry 全局追踪器）
    - `screen-capture.js` — 屏幕采集与动态 1fps 压缩
    - `audio-capture.js` — 麦克风录音与降频
    - `audio-worklet.js` — 运行在音频线程的 Float32 转 PCM 16-bit 处理器

## Commands
| 操作 | 命令 |
|------|------|
| Install | `npm install` |
| Start (网页版) | `npm start` |
| Dev (网页版) | `npm run dev` |
| Start (桌面版) | `npm run electron` |
| Build (打包包) | `npm run build` |

## Code Conventions
- **命名规范**：变量、函数、实例均使用 `camelCase`（驼峰命名法）；模块类定义使用 `PascalCase`（例如 `ScreenCapture`）。
- **模块规范**：后端使用 CommonJS（`require`/`module.exports`）；前端为无框架纯原生 JS 类，通过全局引用或实例传递。
- **错误处理**：后端对 Gemini Live API 连接及发送过程进行全面的 `try-catch` 捕获，并通过 WS给前端推送 `type: 'error'` 消息；前端在收到错误消息时，自动使用系统消息在对话框渲染警示内容。
- **资源清理**：媒体资源在停止、断开或切换时，必须主动显式关闭、解绑并释放对应的 tracks 与 context。桌面端前台使用全局 `MediaRegistry` 挂载 `beforeunload` 事件进行物理设备脱钩。

## Boundaries

**Always Do**
- 保持 `server.js` 顶部的 WebSocket 代理猴子补丁，使国内开发测试时能够自适应继承系统代理。
- 音频降采样及 PCM 传输时，必须固定使用 **16000Hz PCM 16-bit** 采样率，以符合 Gemini 接收标准。
- 视频截图压缩发往 API 之前，限制最大宽度在 1280px 像素内，以保证极速响应。
- 主进程注册 `session.defaultSession.setDisplayMediaRequestHandler` 自动获取系统主显示源，打通 Electron 权限，并且退出时执行 `globalShortcut.unregisterAll()`。

**Ask First**
- 更改 WebSocket 消息交互协议（`text`, `audio`, `frame`, `text_chunk`, `audio_chunk`, `turn_complete`, `status`）。
- 更换或升级底层的 `@google/genai` 依赖库。
- 将 `responseModalities` 从仅 `['AUDIO']` 修改为其它多模态组合。

**Never Do**
- **千万不要**在 `index.html` 或 `main-app.html` 中直接通过 `<script src="audio-worklet.js">` 引用音频工作处理器，这会造成主线程 `AudioWorkletProcessor is not defined` 的加载崩溃。
- 千万不要硬编码 `GEMINI_API_KEY` 在任何代码文件中。
- 千万不要在连接建立完毕（收到 `Gemini Live Session Ready` 状态）之前向 Session 发送 `text` 或多媒体 data。
- 千万不要在主窗口隐藏（hide）时以它为 parent 创建带有 `modal: true` 的子窗口，这在 Windows 上会导致死锁或窗口隐身。

## Recent Progress & Project Status

### 已实现核心功能与改进
1. **多模态实时交互就绪 (E2E 通道打通)**：打通了麦克风采集（16000Hz PCM）和屏幕画面重采样压缩发送的底层通道。
2. **解决用户讲话无反应 Bug (转写流引入)**：在后端代理新增对 `inputTranscription` 和 `outputTranscription` 的提取和协议转换（封装为 `user_transcription` 和 `text_chunk` ），前端实时流式输出转文字结果。
3. **音频单例防崩溃重构**：音频输入（AudioCapture）和输出播放（AudioPlayer）全面复用单例 AudioContext，解决高频重启崩溃。
4. **高能效打断机制 (Barge-in)**：打断时仅销毁活动音源节点，实现毫秒级瞬间静音，并在前台应用气泡置灰渐变及 `(已打断)` 指示。
5. **动态截图大小与质量优化**：截图的 JPEG 质量为 `0.4`，大幅缩减包体，防止 TCP 队头阻塞。
6. **时序安全启动保护**：前台帧推送仅在 WebSocket 通道建立成功（`ws.onopen`）之后才实际激活。
7. **首创 WebSocket 动态代理热重载**：在 `server.js` 构建构造函数级动态代理提取机制，配置更新免重启对后续连接生效。
8. **硬件防漏安全锁 (MediaRegistry)**：通过 `MediaRegistry` 追踪全部流轨道，绑定 `beforeunload` 安全事件，在任何离线或关闭时物理调用 `track.stop()`，保证硬件指示灯完全安全熄灭。
9. **一键 API 连通性预检测**：在设置页提供 `🔌 测试连接` 特性，采用 8s 超时通过代理对 Gemini 官方 endpoint 发起 HTTP 探针请求。
10. **原生桌面特性装配**：内置 System Tray 原生系统托盘、`Alt + Space` 全局窗口热键切换、以及 Native Notification 系统消息横幅通知。
11. **服务端消息排队缓存 (Pending Queue)**：在 `server.js` 建立消息暂存区，若会话建立时处于 `CONNECTING` 状态则暂存客户端数据包，待 `Session Ready` 后按序消费，彻底规避时序冲突引起的前期画面或语音丢失。
12. **共享单例 AudioContext 升级**：前端暴露 `window.getSharedAudioContext()`，实现音响播放与录音采集的深层单例复用，隔绝了音频设备冲突隐患。
13. **多媒体 API 强类型适配与 file:// 路径适配**：升级数据结构为最新的 `audio` / `video` 强类型，杜绝 `media_chunks` 废弃警告；自适应判断 `file://` 协议修正 `audio-worklet.js` 的引用路径。
14. **声卡竞争消除与进程占用自愈自救**：全局共享唯一 `AudioContext` 消除通道冲突；启动时自动扫描并强杀 3000 端口残留 Node 僵尸进程，避免连接回旧后端。
15. **窗口状态同步增强**：向自定义标题栏中插入最大化/还原按钮（⬜/❐），并实现双击标题栏或点击按钮触发窗口全屏最大化，以及状态双向同步与文字标签动态更新。
16. **音量控制百分比与小窗精简**：主界面与悬浮窗音量滑块增加数字百分比（0-100%），小窗合并最大化/还原为单按钮（❐）。
17. **视觉细节清理**：移除自定义标题栏中的“未连接/已连接”左侧红点。
18. **TLS 握手异常拦截与代理机制优化**：Monkeypatch 主进程 `tls.connect` 挂载持久 Socket `error` 监听器阻止未捕获异常崩溃；重构系统代理检测，严格区分 `PROXY`（HTTP 443 端口代理）与 `HTTPS` 类型以防协议混淆，允许手动输入的 `用户名:密码@` 认证代理进行正常测试。
- **系统代理提取与零配置出网**：启动时异步调用 `session.resolveProxy` 探测系统代理并自动注入至 Node.js 进程的 `HTTPS_PROXY` 环境变量，实现国内 95% 开启系统代理用户的零配置“即开即用”出网。
- **Https 代理协议智能 Fallback**：测试连接时，若 `https://` 前缀的 443 端口代理发生 TLS 握手异常报错，程序会自动修改前缀为 `http://` 重新探测。若重试成功则返回信号并在设置界面自动修正且弹窗引导用户固化保存。
- **PendingQueue 串行安全消费**：将 WebSocket 就绪前消息排队缓冲（`pendingQueue`）由并发刷写重构为 `for...of` 加 `await` 串行依次消费，彻底消除了帧与文本时序竞态引起的 API 状态冲突与数据丢失。
- **端口占用清理误杀防范**：`killProcessOnPort` 提取 PID 时增加 Local Address 字段校验（确保以 `:${port}` 结尾），完美杜绝了因 PID 包含目标端口号或端口前缀相似导致的其它服务进程误杀漏洞。
- **测试连通性健壮性强化**：对测试网络探针 Promise 执行器加装了最外层的 `try-catch` 同步异常兜底，杜绝了在测试发起阶段由于参数或参数格式问题产生的同步抛错使 Promise 挂起的问题。
- **默认声音调整为女声与输入焦点修复**：将系统默认 Gemini 输出声音由男声（Puck）修改为清亮女声（Aoede）；解决了由于 Electron 无边框拖拽区域继承问题导致设置面板内容区（select 下拉框、textarea 文本域）无法点击获取焦点的 Bug（通过在 content 与 footer 容器中显式声明 `-webkit-app-region: no-drag;` 修复）。
19. **消息队列串行消费安全**：修复了 `pendingQueue` 异步刷写时的并发时序漏洞，采用 `isFlushing` 锁机制确保消息完全串行、顺序发送给 Gemini。
20. **共享音源释放安全**：在 `AudioCapture.stop()` 里移除 `suspend()` 挂起调用，防止误伤共享 context 下的 AI 语音播放。
21. **屏幕共享来源校验与 Constraints 修复**：为主进程的屏幕共享拦截加装了 Origin 安全过滤，仅允许本地协议和 localhost 申请；简化了前端 constraints 为 `{ video: true, audio: false }`，彻底解决了 `Invalid capture constraints` 导致的屏幕共享启动失败报错。
23. **全面 Code Review 与 Subagent 静态测试整改**：基于 9 维度（逻辑错误、边界情况、Null 引用、竞态、安全漏洞、资源管理、API 契约、UI 一致性、AGENTS 合规）进行完整静态分析，共识别并修复 15 项问题（含 IPC 监听器泄漏修复、flushQueue try-finally 锁保护、screenCapture null 守卫、package.json 隐式依赖补全、Origin 白名单加 IPv6 ::1、Markdown \r\n 兼容、AudioContext fallback 采样率修正等）。同时完成 preload.js safeOn 封装统一清理、style.css disabled 态补全、settings.html HTML 标签修正等 UI 细节。

### 当前项目状态
* **状态**：已完成全面 Code Review（项目结构 + UI）与 Subagent 静态测试整改。屏幕共享 `Invalid capture constraints` Bug 已修复，IPC 监听器泄漏、消息队列锁防护、依赖声明、Origin 白名单、Markdown 渲染兼容性等问题均已修复并 committed。项目当前处于稳定可用状态。


# LiveScreen 进度

## 现在在做
- 阶段：完成自适应代理更新系统开发与漏洞加固收尾（已完成）
- 停在：设计并实现了自适应代理一键检查更新与覆盖升级系统，包括 302 重定向下载器、Windows 文件锁与并发竞态加固，完美保留本地安全加密配置不丢失。
- 下一步：开始进行 Phase 2 的窗口与屏幕共享源视觉选择组件，以及屏幕涂鸦工具的设计

## 近期待办（3条以内）
- [ ] 启动并设计 Phase 2 的 OBS 级窗口/多显示器共享选择界面
- [ ] 收集在复杂的蓝牙或外接独占声卡设备下 SharedAudioContext 的连通表现
- [ ] 收集不同代理环境下 TLS 错误细化拦截和警告的可视化反馈

---

# LiveScreen 项目进度（历史）

## 项目目标
将现有的 Node.js + Web 端 LiveScreen (Gemini 实时流式屏幕/语音辅导 Demo) 改造为功能完备、具备原生悬浮小窗、动态代理与安全隐私保护的 Windows 桌面级应用程序。

---

## 模块进度

| 模块 | 说明 | 状态 | 备注 |
|------|------|------|------|
| 基础 Express/WS 服务 | server.js 静态托管、WS 安全管道及 Gemini 通信 | 🟢 已完成 | 新增 20s 心跳探活机制 |
| 设置持久化与安全 | safeStorage 本地 settings.json 配置读写与加密 | 🟢 已完成 | store.js 实现 |
| 媒体请求拦截捕获 | 主进程 DisplayMedia 请求劫持与 desktopCapturer 授权 | 🟢 已完成 | 一键屏幕共享 |
| UI 视觉与交互重构 | Clay 粘土微质感阴影、打字机增量防抖、打断渐变 | 🟢 已完成 | 全面升级 |
| 悬浮窗自适应拉伸 | CSS 容器查询，极窄高度下 100% 预览图像，预览图 drag | 🟢 已完成 | mini.html 实现 |
| 连接连通性测试 | 保存设置前直接通过 IPC 探测 Google API 与代理连线状态 | 🟢 已完成 | 实现智能代理协议 Fallback 与系统代理自适应提取 |
| 桌面端原生集成 | 原生系统托盘 (Tray)、系统消息 (Notification) | 🟢 已完成 | main.js 实现 |
| system 全局快捷键 | Alt+Space 热键智能切换主窗口与小窗，退出解绑 | 🟢 已完成 | main.js 实现 |
| 物理媒体防漏电 | 捕获 beforeunload 遍历 MediaRegistry 所有轨物理 stop | 🟢 已完成 | 隐私安全层 |
| 最大化/还原控制按钮 | 自定义无边框标题栏新增 ⬜/❐ 最大化控制及双向状态同步 | 🟢 已完成 | main-app.html 与 main.js 实现 |
| API 废弃与路径兼容 | 适配最新 Gemini `audio`/`video` 格式及 `file://` 寻址 | 🟢 已完成 | server.js 与 audio-capture.js 实现 |
| 并发声卡资源归一 | 全局复用 SharedAudioContext 实例，从根本上解决冲突挂起 | 🟢 已完成 | app.js 与 audio-capture.js 实现 |
| 端口自愈与队列缓存 | 自动强杀 3000 残留进程并增加 pendingQueue 数据缓冲 | 🟢 已完成 | main.js 与 server.js 实现 |
| 桌面窗口体验细节 | 小窗按钮精简、显示音量百分比、去除顶栏红点、TLS 崩溃防护 | 🟢 已完成 | 实现音量数字显示与 Socket 异常拦截 |
| 消息队列与声卡保护 | 修复 pendingQueue 异步消费竞态及 audio stop 误杀共享 Context 冻结播放 | 🟢 已完成 | server.js 与 audio-capture.js 实现 |
| 屏幕分享安全与兼容 | setDisplayMediaRequestHandler 加入 Origin 检验并省略 audio 约束解决 Invalid 错误 | 🟢 已完成 | main.js 与 screen-capture.js 实现 |
| Code Review 整改 | 9 维度静态分析整改 15 项（IPC 泄漏、锁防护、依赖补全、Origin ::1、Markdown 兼容等） | 🟢 已完成 | 全项目文件覆盖 |
| 迷你窗关闭优化 | 点击迷你窗关闭按钮仅 hide 隐藏不退出，主窗口关闭才真正退出 | 🟢 已完成 | main.js 与 mini.html 实现 |
| 实时语音打断 | 引入服务端 interrupted 信号并通知前端触发播放器瞬间静音和气泡置灰 | 🟢 已完成 | server.js 与 app.js 实现 |
| 自动化发布部署 | 配置 workflows/release.yml，推送标签触发云端 Actions 打包发布 | 🟢 已完成 | package.json 与 release.yml 实现 |
| 自适应代理检查更新系统 | 主界面无边框标题栏新增 🔄 检查更新 按钮，支持代理自适应、302重定向及防爆锁静默替换 | 🟢 已完成 | main.js 与 main-app.html 实现 |

---

## 踩坑记录
- **Electron 的 getDisplayMedia 默认静默拒绝**：在 Electron Renderer 进程中无法像 Chrome 浏览器那样原生弹窗提示选屏，必须在主进程注册 `setDisplayMediaRequestHandler` 并调用 `desktopCapturer` 返回特定屏幕源 ID，才能使 `getDisplayMedia` 顺利拉取流。
- **隐藏状态下模态窗口导致死锁**：若主窗口被 hide()，以它为 parent 创建 `modal: true` 的子窗口在 Windows 上会导致子窗口完全隐身或窗口假死，必须在 `isVisible()` 为 false 时不传 `parent` 并且将 `modal` 设为 `false`。
- **本地文件协议 file:// 阻碍 AudioWorklet 加载**：在桌面端使用相对路径加载 `audio-worklet.js` 时会以 `electron/windows` 为基准引发 404，需检测 `window.location.protocol === 'file:'` 并自适应重写路径为 `../../public/audio-worklet.js`。
- **旧 Node 进程占用 3000 端口引发默默降级连入旧版代码**：在 Electron 容错处理中如果静默降级复用占用端口，极易在开发阶段连入旧版未关闭的 Node 网页服务后台。应在桌面端初始化时利用 `netstat` 检测并安全强杀残留的 `node` 僵尸进程。
- **多 AudioContext 采样率竞争声卡引发挂起**：在 Windows 蓝牙耳机或独占声卡上同时激活 16000Hz (录音) 和 24000Hz (播音) 双通道易锁死声卡，应当归一化为唯一的全局 `SharedAudioContext` 并仅在发送前做软件降采样。
- **`pendingQueue` 在 `await` 期间面临新消息并发插队时序漏洞**：在 session 建立后循环消费 pendingQueue 时，若使用 `for...of` 和 `await`，因为 yields 会让出事件循环，使中途到达的新 WS 消息直接通过 `session.send` 绕过队列被 Gemini 消费。需要使用 `isFlushing` 状态锁强制排空后再允许直连。
- **停止录音时 `AudioContext.suspend()` 会误伤共享的播放器声道**：在全局单例 AudioContext 模式下，对麦克风进行 `suspend()` 释放设备会导致同属一个 context 的 AudioPlayer 也无法播放。只需断开输入节点并 `stop()` track，保持上下文活跃即可。
- **Chromium 在 Electron 拦截模式下对 audio 约束的校验限制**：在 `getDisplayMedia` 中传入 `audio: false`（布尔值）会被 Electron 42.x 的 `setDisplayMediaRequestHandler` 激活时的 constraints 校验器直接拒绝，抛出 `Invalid capture constraints`。正确做法是完全省略 `audio` 字段，主进程 handler 仅 `callback({ video })` 不返回音频轨道，安全等价。
- **IPC 监听器在页面重载时累积泄漏**：`preload.js` 中通过 `ipcRenderer.on` 注册的监听器没有对应清理，页面多次重载后监听器累积。应使用 `safeOn` 封装记录所有频道，并在 `window.beforeunload` 时统一调用 `removeAllListeners`。
- **Windows IPv6 环境下 localhost 解析为 ::1 被 Origin 白名单误拒**：Origin 校验仅包含 `localhost` 和 `127.0.0.1` 时，在部分 Windows 系统 IPv6 优先配置下，本地请求的 hostname 会为 `::1`，被错误拦截导致屏幕共享失败。需在白名单中显式追加 `::1`。
- **Gemini 语音打断必须依赖服务端 `interrupted` 事件状态转发**：在长开麦模式下，当 AI 播音中途用户开始说话，客户端无法自行判断何时打断。必须由后端 `server.js` 监听 Gemini 回包中的 `serverContent.interrupted === true` 信号，并用自定义 WS 包实时通知渲染进程 `audioPlayer.stop()` 瞬间停止播放，解决用户讲话时 AI 仍旧滔滔不绝的问题。
- **Windows 下未释放写入流句柄导致 unlink 因文件锁定报错**：在取消下载更新包时，如果未显式调用 `fileStream.destroy()`，Windows 会独占锁定正在写入的 exe 临时文件，使 `fs.unlink()` 因“拒绝访问”静默失败，影响下一次下载。应引入全局自增 ID 隔离前后多次重试请求，并在取消时手动销毁写入流并延迟 100ms 再进行 unlink 物理删除。

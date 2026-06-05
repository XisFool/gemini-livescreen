# LiveScreen 进度

## 现在在做
- 阶段：代理自适应出网与界面交互体验调整已完成并验证通过
- 停在：完成系统代理自动提取注入、Https 代理 Fallback 智能修正、排队时序安全性、端口清理严格匹配，并将默认发音切换为女声（Aoede），同时彻底修复了无边框拖拽导致设置面板输入域无法点击焦点的 Bug。
- 下一步：收集复杂多设备及代理网络环境下的用户反馈

## 近期待办（3条以内）
- [ ] 收集用户对于主窗口“最大化/还原”拉伸布局的体验反馈
- [ ] 观察在复杂的 Windows 系统设备（如各种蓝牙耳机）下全局唯一的共享 SharedAudioContext 表现
- [ ] 收集不同代理客户端（Clash, Sing-box, v2ray等）下的自适应系统代理注入回传表现

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
| 系统全局快捷键 | Alt+Space 热键智能切换主窗口与小窗，退出解绑 | 🟢 已完成 | main.js 实现 |
| 物理媒体防漏电 | 捕获 beforeunload 遍历 MediaRegistry 所有轨物理 stop | 🟢 已完成 | 隐私安全层 |
| 最大化/还原控制按钮 | 自定义无边框标题栏新增 ⬜/❐ 最大化控制及双向状态同步 | 🟢 已完成 | main-app.html 与 main.js 实现 |
| API 废弃与路径兼容 | 适配最新 Gemini `audio`/`video` 格式及 `file://` 寻址 | 🟢 已完成 | server.js 与 audio-capture.js 实现 |
| 并发声卡资源归一 | 全局复用 SharedAudioContext 实例，从根本上解决冲突挂起 | 🟢 已完成 | app.js 与 audio-capture.js 实现 |
| 端口自愈与队列缓存 | 自动强杀 3000 残留进程并增加 pendingQueue 数据缓冲 | 🟢 已完成 | main.js 与 server.js 实现 |
| 桌面窗口体验细节 | 小窗按钮精简、显示音量百分比、去除顶栏红点、TLS 崩溃防护 | 🟢 已完成 | 实现音量数字显示与 Socket 异常拦截 |

---

## 踩坑记录
- **Electron 的 getDisplayMedia 默认静默拒绝**：在 Electron Renderer 进程中无法像 Chrome 浏览器那样原生弹窗提示选屏，必须在主进程注册 `setDisplayMediaRequestHandler` 并调用 `desktopCapturer` 返回特定屏幕源 ID，才能使 `getDisplayMedia` 顺利拉取流。
- **隐藏状态下模态窗口导致死锁**：若主窗口被 hide()，以它为 parent 创建 `modal: true` 的子窗口在 Windows 上会导致子窗口完全隐身或窗口假死，必须在 `isVisible()` 为 false 时不传 `parent` 并且将 `modal` 设为 `false`。
- **本地文件协议 file:// 阻碍 AudioWorklet 加载**：在桌面端使用相对路径加载 `audio-worklet.js` 时会以 `electron/windows` 为基准引发 404，需检测 `window.location.protocol === 'file:'` 并自适应重写路径为 `../../public/audio-worklet.js`。
- **旧 Node 进程占用 3000 端口引发默默降级连入旧版代码**：在 Electron 容错处理中如果静默降级复用占用端口，极易在开发阶段连入旧版未关闭的 Node 网页服务后台。应在桌面端初始化时利用 `netstat` 检测并安全强杀残留的 `node` 僵尸进程。
- **多 AudioContext 采样率竞争声卡引发挂起**：在 Windows 蓝牙耳机或独占声卡上同时激活 16000Hz (录音) 和 24000Hz (播音) 双通道易锁死声卡，应当归一化为唯一的全局 `SharedAudioContext` 并仅在发送前做软件降采样。

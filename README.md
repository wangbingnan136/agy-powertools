<div align="center">
  <img src="assets/logo.svg" width="72" height="72" alt="Agy Powertools Logo" />
  <h1>Agy Powertools</h1>
  <p><strong>Antigravity 2.0 原生增强插件</strong></p>
  <p>中文界面、上下文与用量统计、紧凑排版、会话分支与编辑、多账号切换、免 TUN 代理、SSH 与 WSL2 支持</p>
  <!-- plugin-badges:start -->
  <p>
    <a href="https://github.com/WhiteBr1ck/agy-powertools/releases"><img src="https://img.shields.io/github/v/release/WhiteBr1ck/agy-powertools?label=Release&color=2563eb" height="20" alt="Release" /></a>
    <a href="https://github.com/WhiteBr1ck/agy-powertools/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/WhiteBr1ck/agy-powertools/ci.yml?label=CI" height="20" alt="CI" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/WhiteBr1ck/agy-powertools?label=License&color=16a34a" height="20" alt="MIT License" /></a>
    <img src="https://img.shields.io/badge/Antigravity-2.35.0-0f172a" height="20" alt="Antigravity 2.35.0" />
    <img src="https://img.shields.io/badge/Node.js-%3E%3D22.13-339933" height="20" alt="Node.js >= 22.13" />
    <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20WSL2-475569" height="20" alt="Platform" />
  </p>
  <!-- plugin-badges:end -->
  <p>
    <strong>简体中文</strong> |
    <a href="README_EN.md">English</a>
  </p>
  <p>
    <a href="#界面预览">界面预览</a> |
    <a href="#主要功能">主要功能</a> |
    <a href="#安装与卸载">安装与卸载</a> |
    <a href="#配置说明">配置说明</a> |
    <a href="#更新日志">更新日志</a>
  </p>
</div>

<p align="center">
  <img src="docs/images/hero-workspace.png" alt="Agy Powertools 使用界面" width="100%" />
</p>

> 通过本机调试接口挂载在 Antigravity 2.0 内部，只读解析本地 SQLite 和 JSONL 会话记录，不修改客户端安装文件，也不打开外部网页。

---

## 界面预览

<table>
  <tr>
    <th width="50%">上下文窗口与生成速度</th>
    <th width="50%">右侧任务进度与当前额度</th>
  </tr>
  <tr>
    <td>
      <img src="docs/images/card-composer.png" alt="上下文窗口与生成速度" width="100%" />
      <p>在输入框旁查看上下文占用、缓存复用和实时生成速度；外框可选显示当前模型的剩余额度。</p>
    </td>
    <td>
      <img src="docs/images/card-overview-panel.png" alt="右侧任务进度与当前额度" width="100%" />
      <p>在右侧概览查看当前运行阶段、每步耗时和各模型组剩余额度，点击标题可折叠收起。</p>
    </td>
  </tr>
  <tr>
    <th>用量概览（浅色）</th>
    <th>用量概览（深色）</th>
  </tr>
  <tr>
    <td>
      <img src="docs/images/card-dashboard-light.png" alt="用量概览浅色主题" width="100%" />
      <p>默认按本轮周限额周期统计请求次数、Token、缓存命中率、参考费用、53 周热力图和模型健康状态。</p>
    </td>
    <td>
      <img src="docs/images/card-dashboard-dark.png" alt="用量概览深色主题" width="100%" />
      <p>随客户端切换浅色和深色主题，对比各模型的 Token 与费用占比、缓存命中率和平均速度。</p>
    </td>
  </tr>
  <tr>
    <th>请求记录与缓存异常</th>
    <th>多账号切换与额度（默认关闭）</th>
  </tr>
  <tr>
    <td>
      <img src="docs/images/card-requests.png" alt="请求记录与缓存异常" width="100%" />
      <p>按账号、模型、会话和状态筛选单次请求，标出短间隔内异常掉缓存的记录，排除冷启动与上下文压缩误报。</p>
    </td>
    <td>
      <img src="docs/images/card-accounts.png" alt="多账号切换与额度管理" width="100%" />
      <p>通过系统凭据管理器本地保存和切换多个 Google 账号，集中查看 5 小时和周限额。</p>
    </td>
  </tr>
  <tr>
    <th>多语言与显示设置</th>
    <th>免 TUN 独立代理（默认关闭）</th>
  </tr>
  <tr>
    <td>
      <img src="docs/images/card-settings.png" alt="多语言与显示设置" width="100%" />
      <p>支持简体中文、繁體中文和 English 切换，包含紧凑排版与用户消息底色等选项。</p>
    </td>
    <td>
      <img src="docs/images/card-proxy.png" alt="免 TUN 独立代理设置" width="100%" />
      <p>单独为 Antigravity 配置 HTTP 或 SOCKS5 代理，内置连通性测试、强制 HTTP/1.1 与应用内检查更新。</p>
    </td>
  </tr>
</table>

---

## 主要功能

- **多语言汉化（简 / 繁 / 英）**：翻译 Antigravity 常用侧栏、菜单、权限弹窗、模型说明、设置页和 Swarm 面板，不改动聊天正文与代码块。
- **上下文与速度统计**：在输入框旁查看上下文窗口占用（含缓存复用、压缩次数和 Orchestrator 规划/执行分模型进度）以及生成速度（`tok/s`、首字延迟、模型/工具耗时和本会话参考费用），支持子智能体统计。
- **本地用量与请求看板**：左侧栏新增 `Powertools` 页面，包含用量概览（热力图、模型分布、参考费用）、请求记录、短间隔缓存异常标红、报错一键复制、配额估算和官方参考单价拉取。
- **紧凑排版与阶段汇报**：保留客户端字号，收紧正文行高和段落间距；Agent 连续调用工具时先简要汇报进度，整轮完成后自动折进顶部用时栏。
- **会话分支、编辑与完整 Markdown 复制**：可从任意历史回答或会话菜单分支出新会话（完整保留历史，支持含子智能体的会话）；支持在原位置修改已发消息重发；支持整段或截至指定轮次复制完整会话为 Markdown（含工具调用参数、执行结果与长文本补全，支持 SSH 远端）。
- **类 Codex 工作流增强**：支持本地与 SSH 历史会话全文搜索（`⌘+⌥+F` / `Ctrl+Alt+F` 直达匹配轮次并一键复制代码块或命令）、标题栏搜索会话按钮右侧的运行中会话铃铛与侧栏「优先事项」视图、输入框只读 Git 状态与 Diff 预览胶囊（`+X / -Y`）、`/goal` 目标常驻栏与右侧抽屉实时编辑，以及可选务实编码模式和 `/code-review` 只读审查技能。
- **多账号切换（默认关闭）**：基于 Windows 凭据管理器、macOS 钥匙串或 Linux Secret Service 本地隔离多个 Google 账号，不落明文令牌；侧栏底部可直接看额度、切号，支持耗尽自动切号。
- **免 TUN 独立代理（默认关闭）**：无需开启系统全局代理，单独给 Antigravity 注入代理参数和环境变量；内置连通性测试、冷启动未启用提醒，以及可选 `GODEBUG=http2client=0` 缓解 `EOF` 断连。
- **粘贴 SSH 连接命令**：在「新建项目 → SSH Host」的主机框粘贴 `ssh -p 2222 user@host`，自动填成 `user@host:2222`。若同一行或下一行附带密码，不会填入或提交；点「连接」后按原生提示输入。可在「Powertools → 设置 → SSH」随时开关，无需重启。
- **SSH 远程与 WSL2 支持**：桌面端连 `SSH` 远端窗口时直接读取远端会话与用量统计，不需要在服务器装插件；Windows Antigravity 开启内置 WSL2 模式时，自动处理跨系统 CDP 连接（兼容 NAT 和 Mirrored）、多账号凭据与重启。
- **文件右键与外部编辑器直达**：右键消息中的文件链接或右侧文件树可引用到输入框、在外部编辑器打开并直达指定行列（支持自动探测 `Cursor` / `VS Code` / `Windsurf` / `Zed` 及 WSL2 路径）、默认应用打开、定位文件夹、复制文件或复制路径（Windows 支持局域网 NAS 共享路径）；右侧概览支持可折叠的任务进度与当前额度，另提供窗口标题未读数与用户气泡底色。

---

## 安装与卸载

> 环境要求：先安装并启动过一次 Antigravity。优先使用本机 Node.js `>= 22.13`，没有时自动使用客户端自带的 `agy-node`，无需 `npm install` 或管理员权限。

### 方式一：发给 Agent 自动安装（推荐）

把下面这段话直接发给 Antigravity 或其他可执行本地命令的 Agent：

> 请帮我安装 Agy Powertools：https://github.com/WhiteBr1ck/agy-powertools 。先阅读 README 和 docs/INSTALL_AGENT.md，使用项目提供的统一安装器，优先使用已有 Node.js 或 Antigravity 自带运行环境。保留其他插件、账户设置和聊天记录，不要强制退出当前客户端。安装后核对版本并告诉我结果；需要重启时最后提醒我。

详细步骤见 [Agent 安装指南](docs/INSTALL_AGENT.md)。

### 方式二：命令行安装

从 [Releases](https://github.com/WhiteBr1ck/agy-powertools/releases) 下载最新 ZIP 解压（或克隆本仓库），在项目目录运行：

```powershell
# Windows (PowerShell)
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

```sh
# macOS / Linux / WSL2
sh ./install.sh
```

覆盖安装会保留已有设置，不会强制关闭客户端。完成当前任务后重启 Antigravity，左侧栏出现 **Powertools** 即可使用。macOS 会自动在 `~/Applications/` 生成带原版图标的启动器，拖入 Dock 替代原图标即可。

### 更新与卸载

- **应用内更新**：打开 **Powertools -> 设置 -> 关于 -> 检查更新**，点击 **立即更新** 自动完成 SHA-256 校验与替换，启动失败会自动回滚旧版。
- **卸载**：运行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1`（Windows）或 `sh ./uninstall.sh`（macOS / Linux / WSL2）。末尾加 `--keep-settings` 可保留个人配置。卸载不会影响原有聊天记录、账号和其他插件。

---

## 配置说明

所有选项都在 **Powertools -> 设置** 里实时生效并自动保存（底部支持恢复默认设置）。

<details>
<summary><strong>展开查看全部设置项、环境变量与数据目录</strong></summary>

### 界面与显示

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 启用 Powertools | 开启 | 插件总开关；关闭后暂停所有界面增强，保留已保存设置 |
| 语言 | `简体中文` | 可选 `简体中文`、`繁體中文` 或 `English` |
| 紧凑排版 | 开启 | 收紧行高至 `1.4`、段落间距与工具行高，字号跟随客户端设置 |
| 用户消息气泡着色 | 关闭 | 为用户发出的消息添加淡底色和细边框，支持强调色、5 套预设和自定义颜色 |
| 始终显示会话目录 | 开启 | 在多轮对话左侧常驻显示轮次跳转目录 |
| 切换会话时保持概览 | 开启 | 切换会话时保持右侧概览面板的展开状态 |
| 项目默认显示会话数 | `默认 (6)` | 控制侧栏每个项目默认展示条数（`默认 (6)` / `1-10` / `全部展开`） |
| 任务栏未读提醒 | 开启 | 后台对话完成时在窗口和任务栏标题前显示 `(N)` 未读数，切回后消除 |
| 侧栏运行中会话铃铛 | 开启 | 在顶部搜索会话按钮右侧显示铃铛按钮，点击立即切换到最近仍在运行的会话并展开侧栏「优先事项」 |

### 统计与进度

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 概览默认时间范围 | `本轮周限额内用量` | 可选本轮周限额内用量、今天、24 小时、昨天、本周、本月、30 天或全部时间 |
| 上下文圆环 | 开启 | 在输入框旁显示上下文占用圆环、缓存复用和 Orchestrator 分模型拆解 |
| 速度与统计 | 开启 | 显示生成速度码表，点击查看会话统计与参考费用 |
| 输入框 Git 状态胶囊 | 开启 | 在输入框底栏显示当前仓库分支与未提交改动行数（`+X / -Y`），点击可展开只读 Diff 预览、引用到对话或在外部编辑器打开 |
| 任务进度 | 开启 | 在右侧概览显示可折叠的任务清单、运行阶段与步骤耗时 |
| 概览显示账号额度 | 关闭 | 在右侧概览底部以可折叠区块显示各模型组的 5 小时和周剩余额度 |
| 子智能体上下文与统计 | 开启 | 在概览子智能体列表、子智能体输入框和主会话浮窗显示子智能体统计 |
| 每轮用时 / 点击展开工具 | 开启 | 在已完成回复顶部显示总耗时，点击展开工具调用与阶段汇报 |

### 会话增强、账号、代理与实验性上下文

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 阶段汇报 | 开启 | 工作时汇报当前进展，整轮完成后收进顶部用时栏 |
| 并行检索与读取 | 关闭 | 引导 Agent 在同一轮合并搜索和读取文件，减少来回轮次 |
| 务实编码模式 | 关闭 | 引导 Agent 直奔根因、只做最小必要改动并执行针对性验证 |
| 会话全文搜索 / 搜索快捷键 | 开启 | 在 Powertools 检索本地与 SSH 历史提问、回复、代码与终端命令（支持 `⌘+⌥+F` / `Ctrl+Alt+F`） |
| 复制会话为 Markdown | 开启 | 在会话菜单与每轮回答菜单复制完整对话（含工具调用参数、执行结果与截断补全，支持截至指定轮次与 SSH） |
| 目标常驻栏与目标编辑 | 开启 | 运行 `/goal` 或将消息设为目标时在输入框上方常驻显示进度与计时，支持暂停、清除及右侧抽屉实时修改 |
| 分支会话 / 消息编辑 / 文件右键 | 开启 | 原生会话分支、原位消息编辑和本地 / NAS / 文件树右键菜单 |
| 首选外部编辑器 | `自动探测` | 文件右键与 Git 状态胶囊使用的外部编辑器（`自动探测` / `Cursor` / `VS Code` / `Windsurf` / `Zed`），支持行列号直达 |
| 启用多账号切换 | 关闭 | 需确认风险提示；含侧栏切换器、列表/卡片视图、5H/周周期与耗尽自动切号 |
| 启用独立代理（免 TUN） | 关闭 | 协议 / 主机 / 端口输入、连通性测试、冷启动提醒和强制 HTTP/1.1 |
| 上下文目标（实验性） | `默认` | 可选 `默认`、`256K`、`500K`、`1M`；`默认` 不改动客户端原生设置 |

### 环境变量与文件路径

| 名称 / 路径 | 说明 |
| --- | --- |
| `ANTIGRAVITY_USER_DATA_DIR` | 使用独立客户端配置目录时指定自定义用户数据目录 |
| `ANTIGRAVITY_CDP_PORT_FILE` | 显式指定 `DevToolsActivePort` 绝对路径（兼容 `AGY_BROWSER_ACTIVE_PORT_FILE`） |
| `~/.gemini/config/plugins/agy-powertools/` | 插件程序与运行脚本安装目录 |
| `~/.gemini/antigravity/plugin_data/agy-powertools/` | 个人设置、账号记录、配额采样和参考单价缓存目录 |

</details>

---

## 更新日志

### v2.14.3
- **适配 Antigravity 2.35.0**：更新原生弹出层内容组件（`JC`）绑定特征以兼容 2.35.0（同时保持向后兼容 2.34.0），恢复所有原生面板与浮窗挂载。
- **补全 2.35.0 界面汉化**：同步适配 2.35.0 中改为句首大写的设置项标题、新增说明文案及 `Load older messages`、`Delete Permanently`、`Return to Inbox` 等菜单项。

### v2.14.2
- **修复多账号「添加账号」热登录后未重启导致约 50 分钟回退旧账号并污染凭据槽的问题（#22、#23，感谢 `@Hi-Jiajun` 的根因排查与 PR）**：
  - 跨平台凭据库（Linux / macOS / Windows / WSL2）新增 `id_token_email` 归属校验，读写备份槽和同步额度前先核对邮箱，拦截跨号覆写与额度串号（对非 JSON 历史凭据自动降级兼容）。
  - 「添加账号」完成同步后新增 `accounts.completeAdd`，在检测到账号变更或令牌轮换时写入 `pendingSwitch` 防覆盖锁并触发受控重启以清除旧 `TokenSource`（重启不可用时优雅降级为手动重启提示，取消登录不触发重启）。

### v2.14.1
- **修复子智能体或后台任务运行中「任务进度」误显已完成的问题**：主会话挂起等待子智能体或非守护后台任务完成时保持运行状态，并细分为「子智能体运行中」和「等待后台任务完成」阶段（常驻守护进程仍正常结束）；同步支持同轮内 `SYSTEM_MESSAGE` 唤醒后的实时状态识别，以及未读角标与自动切号判定对齐。
- **补全 Swarm 面板汉化**：补充非会话页引导语、蜂巢图例、成员与动态计数、任务完成度、导出进度与动态 tooltip 翻译（保留主界面 `Swarm` 入口原文与正文保护）。

### v2.14.0
- **支持 Windows Antigravity + WSL2 后端模式（#21，感谢 `@Hopeless` 的方案设计与真机测试）**：
  - 自动识别 WSL2 并定位 Windows 侧 `%APPDATA%\Antigravity\DevToolsActivePort`；优先直连 `127.0.0.1`（兼容 Mirrored），默认 NAT 下自动通过 Windows `node.exe` / `agy-node.exe` 建立 TCP-over-stdio 桥接。
  - 新增 `vault.probe()` 探测并透出真实报错原因；WSL2 下活跃态成对读写 `0600` 凭据文件，备份槽位存入 Windows 凭据管理器并按 `agy-powertools:wsl:<distro>:account:<id>` 隔离。
  - WSL2 下委托 Windows `powershell.exe` 维护 `.lnk` 快捷方式与重启 `Antigravity.exe`；切号后若自动重启失败提示手动重启；sidecar 启动时自动清理已退出 PID 的旧运行态文件。

### v2.13.9
- **文件右键菜单支持 Windows 局域网 NAS / SMB 路径**：在触碰 SMB 前校验字面量 IP 或通过系统 `dns.lookup` 核验所有解析 IP 均为非公网地址（覆盖局域网 IP、NetBIOS 短名、内网域名、Tailscale / VPN 私网与 `*.localhost` / `wsl$`），同时继续拦截公网主机；修复含空格 UNC 路径在 `explorer.exe /select` 下的定位。

### v2.13.8
- 修复输入框额度光环在新建会话页套住顶部项目/分支栏的问题，改为只挂载在输入卡片上。
- 新增「光环额度周期」选项，支持在 `自动（较低项）`、`周限额` 和 `5 小时限额` 间切换。
- 修复设置页更新说明未解析 Markdown 格式的问题。

### v2.13.7
- 新增「概览显示账号额度」与「输入框额度光环」（#18，默认关闭），并将右侧「任务进度」与「当前额度」改为可折叠样式。
- 多设备混用周限额估算改为增量快照校准，剔除无本机请求的跨设备消耗（#19）。
- 移除 Windows 隐藏 PowerShell 任务栏闪烁调用，消除杀软误报，同时停用遗留 `hooks.json` 钩子（#20）。
- 补全侧栏项目右键菜单、权限审批弹窗以及 `Thought for Xs`、`Step X of Y` 等高频翻译。

<details>
<summary>查看早期版本（v2.10.0 - v2.13.6）</summary>

- **v2.13.6**：精简右侧「任务进度」面板（合并实时阶段、连接线时间轴、单步耗时与右对齐计时），补全 Orchestrator 说明翻译。
- **v2.13.5**：新增可选用户消息气泡着色，收窄请求表列宽，修复路径含 `#` 的文件链接无法打开的问题，补全 2.34.0 界面与弹窗翻译。
- **v2.13.4**：概览默认使用「本轮周限额内用量」（#12），支持 OpenSSH 远程窗口统计（#14），多账号额度隔离与按账号筛选（#9、#11），文件右键支持引用图片与文件，Swarm 面板汉化（#10），修复 `/btw` 分屏统计与瞬时超时误报（#15）。
- **v2.13.3**：支持含子智能体会话的完整分支，macOS 启动器复用原版图标与 Dock 替换指引（#7、#8），补全 2.34.0 菜单翻译。
- **v2.13.2**：概览与请求页新增缓存命中率与短间隔缓存异常标红（#6），新增繁體中文（`zh-TW`），适配 2.34.0 Orchestrator 与动态 Claude 定价解析。
- **v2.13.1**：新增子智能体上下文与统计、任务进度实时阶段提示、概览「今天」范围与辅助面板备用更新通道。
- **v2.13.0**：适配 Antigravity 2.34.0，新增多账号切换与免 TUN 独立代理，修复原位编辑切会话丢失与已安装插件页徽章变形（#5）。
- **v2.12.0 - v2.12.10**：应用内校验更新、组件声明缓存、原位消息编辑、任务栏未读数、上下文/速度双浮窗、本地文件右键菜单（#2）、项目默认会话数与多窗格修复（#1、#3、#4）。
- **v2.10.0 - v2.11.0**：适配 Antigravity 2.32.x 渲染器，重绘 Token 与费用双圆环及全局总开关。

</details>

---

## 协议与链接

- **开源协议**：[MIT License](LICENSE)（日期范围日历交互改编自 HextaUI，基于 `react-day-picker` 与 `date-fns`，许可见 [lib/vendor/NOTICE.txt](lib/vendor/NOTICE.txt)）
- **问题反馈**：[GitHub Issues](https://github.com/WhiteBr1ck/agy-powertools/issues)（提交时请附上操作系统、Antigravity 版本和插件版本）
- **友情链接**：[LINUX DO](https://linux.do/) - 新的理想型社区

# AGENTS.md · 项目规则（供所有 agent 遵循）

## 项目概览
- **GameHub 迷你游戏合集**：纯静态、无构建、无依赖、无后端。GitHub Pages 部署（`pytvr42373.github.io/game-of-life`）。
- 每个子目录一个游戏；除 `light-up/`、`ray-lab/`（html+css+js 分离）外，均为单文件 `index.html`（内联 CSS/JS）。
- `life/src/` 是早期模块化旧版（40×40），**未被引用**；`life/index.html` 内联版（30×30）才是线上版本，勿改 src/。

## 目录与职责
| 路径 | 说明 | 可否修改 |
|---|---|---|
| `index.html` | 主页（开屏、卡片、主题切换、跳转过渡） | ✅ |
| `life/` `1A2B/` `stroop/` `light-up/` `ray-lab/` | 自研游戏 | ✅ |
| `bottle/` | 第三方 fork（倒水） | ⚠️ 只允许改 `index.html` 的 HTML 层；**禁止改 assets/ 内打包产物、sw.js、workbox** |
| `docs/` | 本地调研文档（gitignore，不入库） | — |
| `STYLE_GUIDE.md` | 全局视觉/交互规范的唯一依据 | 改动须先与用户确认 |

## 主题系统（必须遵守）
- 双主题：`body[data-theme="4399"]`（日间清新）/ `body[data-theme="arcade"]`（街机暗色），CSS 变量驱动。
- 持久化 key：`localStorage 'gh-theme'`，全站共享联动。
- 主题切换按钮：右下角 46px 圆形毛玻璃；图标为自绘 SVG（4399=世界树，arcade=吃豆人），不用 emoji。
- 返回按钮：左上角 `.back-home` 毛玻璃胶囊，文案 `← 主页`，链接 `../index.html`。
- **例外**：Stroop 固定 4399（无切换器）；bottle 不参与主题系统（仅保留独立返回按钮）。
- 所有页面须尊重 `prefers-reduced-motion`；动画只动 `transform/opacity`。

## 编码规范
- 原生 JS，禁止引入框架/构建工具/CDN 运行时库。
- 跟随所在文件的既有风格：`1A2B/`、`stroop/` 用 ES5（var + IIFE + function）；`light-up/`、`ray-lab/` 用严格模式 IIFE + const/let；主页/life 内联脚本风格较自由。
- 不新增无意义注释；保留既有注释风格。
- localStorage 读写一律 try/catch（隐私模式兼容）。
- 字体：Google Fonts（Press Start 2P / Bungee / ZCOOL KuaiLe）加载必须**非阻塞**（`media="print" onload="this.media='all'"` 或等效方案），避免网络不可达时白屏。
- 页面 `<head>` 须有尽早生效的背景色兜底（读取 gh-theme 后立即设置 html 背景），消除跳转白闪。

## 测试与验收
- 无测试框架、无 lint 命令。验收方式：
  1. `node ray-lab/game.js` 运行射线逻辑自检（加 `--verify-uniqueness` 可校验题库唯一解，较慢）。
  2. `light-up/game.js` 支持 Node require（`module.exports`），可写临时脚本验证求解器。
  3. 浏览器手动验证：`python3 -m http.server 8000` 后逐页检查（主题切换、返回、加载过渡、reduce-motion）。
- 修改后必须：语法自检（`node --check` 适用于独立 js）、通读 diff 确认无残留调试代码。

## Git 规则
- **未经用户明确要求，不得 commit/push。**
- 提交信息风格：中文、简洁，如「新增点灯与光线侦探并修复1A2B样式」。
- `.gitignore` 保持最小必要：`docs/`（本地文档不入库）+ 常见系统/编辑器/依赖垃圾文件。
- `bottle/audio/`（约 60MB）已被 git 跟踪，属有意为之（Pages 需直接托管音频），勿忽略或删除。

## 并行协作
- 多 agent 并行时，**每个 agent 只允许修改分配给它的文件**，禁止跨文件改动；公共规范变更（STYLE_GUIDE.md、AGENTS.md、根 index.html 的全局结构）由主会话统一处理。
- 若发现工作区有非本任务的未提交改动（其他会话正在编辑），避开该文件并报告。

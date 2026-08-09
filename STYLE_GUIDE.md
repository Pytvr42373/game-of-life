# 游戏合集 · 全局风格规范（STYLE GUIDE）

> 统一 game-of-life 各子游戏的交互与视觉规范，避免各页面实现不一致。
> 本文件是全局统一改动的唯一依据，各页面实现须与之对齐。

## 1. 主题切换（Theme Toggle）
- **适用范围**：主页 `/`、康威 `/life/`、1A2B `/1A2B/`、Stroop `/stroop/`、点灯 `/light-up/`、光线侦探 `/ray-lab/`。
  - **Stroop 固定 4399**（不显示切换器，永远日间）。
  - **倒水 `/bottle/`**：fork 自第三方，**不参与本规范**（保持原样，仅加独立返回按钮）。
- **交互形式**：**右下角单个悬浮圆形按钮**（`position:fixed; right:16px; bottom:16px`，46×46 圆形，半透明毛玻璃底）。
- **图标**：**不用 emoji**，自绘内联 SVG（素材库无现成，自主绘制）：
  - **4399（清新）→ 世界树（Yggdrasil）**：画一棵生命之树（树干 + 树冠 + 根系），清新自然感。参考：主干 + 分叉树枝 + 圆形/云状树冠，`viewBox="0 0 24 24"` stroke 风格。
  - **arcade（街机）→ 吃豆人（Pac-Man）**：经典黄色扇形（圆形去掉一块，张开嘴），街机代表。用 `<path>` 画一个扇形缺口圆。
  - `currentColor` 取 `#22c55e`（清新绿）。
- **点击行为**：单次点击即在两主题间切换，无并列按钮。
- **持久化**：`localStorage.setItem('gh-theme', theme)`，取值 `'4399' | 'arcade'`；进入页面时读取 `gh-theme` 应用。主页与其他小游戏**共享同一 key**，实现联动。
- **DOM 结构**：`<div class="theme-switch" id="themeToggle" role="button" aria-label="切换主题" title="切换主题"></div>`，JS 用 `paintIcon()` 更新 SVG。
- **CSS 变量**：日间/夜间各定义一组 `--bg/--surface/--border/--text/--accent...`，通过 `body[data-theme="4399"]` / `body[data-theme="arcade"]` 切换。

## 2. 返回主页按钮（Back to Home）
- **适用范围**：所有子游戏页（康威、1A2B、Stroop、倒水）。
- **位置**：**左上角** fixed，不遮挡内容，z-index 高于普通内容。
- **文案**：`← 主页`。
- **链接**：相对路径 `../index.html`（从子目录返回仓库根主页）。
- **样式**：半透明毛玻璃胶囊按钮，随主题（浅色/深色）自适应，hover 轻微上浮。
- **统一类名**：`.back-home`（life/1A2B/stroop 统一），倒水用独立 `#bottle-home-btn`（适配其自身样式，不强制统一类名）。

## 3. 双主题切换动画（Theme Transition）
- **统一实现**：切换主题时，页面加遮罩 + 淡入淡出过渡，避免生硬跳变。
- **加载过渡**：页面加载/切换时显示一个**加载进度条**（转环核心 + `load-track` 进度条 + LOADING 文字），短暂展示后淡出。
- **动画原则**：尊重 `prefers-reduced-motion`；动画只动 `transform/opacity`，避免高频动 `box-shadow/filter`。
- **所有小游戏统一**使用同一套切换动画逻辑（复制自主页的 `.loader` + 进度条实现）。

## 4. 布局通用原则
- **康威**：棋盘占主体，控制按钮居下部，title/统计（代数/存活）紧凑不占大空间；title 放页面左上角。
- 移动端可滚动，PC 尽量同屏（棋盘+控件一屏内）。

## 5. 按钮样式规范（原始版，禁止改为 Stroop 圆角卡片风格）

以下按钮样式为各页面的原始设计，已被用户确认。同步风格时只改配色/字体/布局，**不改按钮圆角、padding、font-weight 等基础样式**。

### 康威生命游戏
- `button`：`font-size:.8rem; font-weight:700; padding:9px 16px; border-radius:10px`（4399）
- 4399：`border:2px solid var(--border); border-radius:10px; background:var(--surface)`
- arcade：`font-family:'Press Start 2P'; font-size:.62rem; border:3px solid; border-radius:0; box-shadow:3px 3px 0 var(--hard)`（**无圆角**）
- primary：绿色渐变；danger：橙色边框

### 1A2B 猜数字
- `.length-pick button`：`font-weight:700; font-size:14px; padding:8px 14px; border-radius:10px`
- `.new-btn`：`font-weight:700; font-size:14px; padding:8px 16px; border-radius:10px`
- `.key`：`border-radius:8px`（键盘按键）
- `.hud .chip`：`border-radius:999px`（胶囊式，不是卡片式）

### 通用规则
- **不要用 Stroop 的 `--shadow-sm/md/lg`、`--radius` 变量覆盖各页面原始按钮样式。**
- Stroop 的卡片式按钮（menu-card）是 Stroop 专属，不推广到其他页面。
- 各页面保持自己的按钮圆角、padding、font-weight 不变。

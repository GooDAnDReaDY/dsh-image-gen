# 📦 @goodandready/dsh-image-gen

<div align="center">

<h3>DeepSeek Harness 全能图像生成与视觉处理插件</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@goodandready/dsh-image-gen"><img src="https://img.shields.io/npm/v/@goodandready/dsh-image-gen.svg?style=for-the-badge&color=6366f1&labelColor=1e1b4b" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/GooDAnDReaDY/dsh-image-gen.svg?style=for-the-badge&color=10b981&labelColor=064e3b" alt="license"></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-Plugin-8b5cf6.svg?style=for-the-badge&labelColor=2e1065" alt="DSH Plugin"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-20%2B-f59e0b.svg?style=for-the-badge&labelColor=451a03" alt="Node version"></a>
</p>

<p align="center">
  <a href="https://goodandready.app/"><img src="https://img.shields.io/badge/作者所有项目-goodandready.app-ff4500.svg?style=for-the-badge&logo=rocket&logoColor=white&labelColor=1a1a2e" alt="所有项目"></a>
</p>

<p align="center">
  <a href="README.md"><b>🇬🇧 English</b></a> •
  <a href="README.ru.md"><b>🇷🇺 Русский</b></a> •
  <a href="README.zh.md"><b>🇨🇳 中文说明</b></a>
</p>

<table align="center">
  <tr>
    <td align="center">
      ⭐ <strong>如果您喜欢这个插件，请在 GitHub 上为它点亮 Star</strong> — 这能让我知道插件对您有用，并鼓励我继续开发和维护它。
      <br><br>
      🐛 <strong>如果您发现 Bug 或希望增加功能</strong>，请使用任意语言在 GitHub 上提交 Issue — 我会评估您的建议，并在后续版本中实现有价值的改进。
    </td>
  </tr>
</table>

</div>

---

## ⚡ 核心功能与架构提升 (v0.10.0)

**`@goodandready/dsh-image-gen`** 为 DeepSeek Harness 提供工业级高可用的图像生成与视觉处理工具链：
* **8大后端全面支持**: FAL.ai、Replicate、OpenAI/SiliconFlow、ChatGPT Plus (OAuth)、Grok Imagine (OAuth)、ComfyUI/A1111 本地生成、ByteDance SeaDream 与 Google Imagen 3。
* **指数退避与 Jitter 队列防爆**: 针对 FAL 与 Replicate 异步队列引入智能 Backoff 轮询，彻底杜绝 429 报错。
* **确定性哈希缓存 (Deterministic Cache)**: 相同 Prompt 与 Seed 的重复请求直接从本地秒级返回，零 API 消耗。
* **ComfyUI / Automatic1111 拖拽直通**: PNG 元数据原生内嵌标准 `Parameters` 块，生成图片可直接拖入 WebUI/ComfyUI 还原参数。
* **尺寸 64 倍数自动对齐**: 自动对齐 VAE 运算尺寸，避免图像失真。
* **多风格预设增强**: 内置 `cinematic`、`anime` 等风格的独立 Negative Prompt 与 Guidance Scale 优化。

---

## 🚀 更新 v0.10.24: 质量加固 — 发布边界、设置状态、主题颜色与模块拆分 (#235–#242)
* **发布边界**: 新增 `.gitattributes`，对 `AGENTS.md`、`index.md`、`docs/`、`.gitea/` 设置 `export-ignore`，GitHub source 归档与 `git archive` 不再包含内部工作流文件。
* **设置状态回退**: 修正设置卡片中的提供方/配置状态处理，部分或未知状态不再误显示为 “unavailable”。
* **对齐设计系统**: 将残留的 `fal-` CSS 类前缀改为 `ig-`，并以 `var(--dsw-alias-*, <fallback>)` 绑定 DSH 主题变量。
* **敏感文件加固**: 历史记录、缓存 meta/data 与花费计量写入后强制 `0600` 权限。
* **死代码清理与模块拆分**: 删除未使用的 `listCuratedStyles`；拆分过大的服务端模块 — `providers.js` 工具函数抽到 `provider-utils.js`，`processing.js` 拆为 `processing-basic.js` + `processing-advanced.js`。客户端拆分见 #244。

## 🚀 更新 v0.10.23: 应用内一键更新、设置同步、真实探针与语言规范 (#232)
* **应用内一键自动更新**: 设置卡片内新增「插件更新」模块（`UpdaterSection`），配合 `/api/dsh-image-gen/update` 接口。自动查询 npm 官方注册表，对比语义化版本号，并在本地回环或私有局域网安全授权下执行 `dsh plugin add @goodandready/dsh-image-gen@latest`。
* **1:1 核心配置与界面设置同步**: 严格对齐 `lib/index.js` 宿主 `Config` 与 `lib/client.js` 界面字段，在「✨ 提示词增强」标签页下完整呈现 `autoEnhancePrompt`（智能自动增强提示词）与 `defaultStylePreset`（默认风格预设）。
* **真实网络诊断探针**: 在 `testProviderConnection` 中为 Replicate (`/v1/models`)、Google Gemini (`/v1beta/models`) 及字节跳动 Seedream 增加带超时保护的真实 HTTP 网络探测与延迟往返测速。
* **严格多语言纯度标准**: 核心代码完全遵照 DSH 插件规范，内置纯净完整的 `en` 和 `zh` 词典；俄语支持通过 `goodandready/dsh-russian-lang` 独立注册。`lib/` 源码中完全清理非拉丁字符。
* **WAI-ARIA 无障碍访问支持**: 为标签页切换与表单错误提示加入 `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, `role="tabpanel"`, `aria-describedby` 和 `role="alert"`。

## 🚀 更新 v0.10.22: 设置卡片状态引用稳定性与修复 React Error #185 无限循环 (#230)
* **设置卡片状态引用稳定性**: 修复了 `FalSettingsCardController` 和 `CardForm.prototype.bind` 中引发的 React Error #185（`Maximum update depth exceeded`）。快照在渲染周期内进行引用缓存（`Object.is(prev, next) === true`），彻底杜绝 React 18 / `useSyncExternalStore` 的无限重新渲染死循环。
* **深度 DSH 运行时集成**: 无缝集成官方 `@deepseek-ai/dsh-client-store`（`runtime.createSnapshotStore`），并提供零依赖的高性能独立快照缓存兜底。
* **自动化回归测试集**: 在 `test/client-syntax.test.mjs` 中引入针对引用一致性的专项测试，严密校验多次连续读取的一致性、单次发布通知机制与监听器注销完整性。

## 🚀 更新 v0.10.21: 变体工作台、智能比例裁切与品牌资源包导出 (#228)
* **交互式变体与风格重混工作台 (Remix Workbench)**: 直接集成在 `FalImageCard` 和图库中的交互抽屉。支持连续创意度/去噪强度滑块 (0.05 到 0.95)、预设快捷按钮（“微调 0.25”、“强创意 0.65”）及提示词引导。
* **智能比例无损画布裁切器 (`smart_crop_image`)**: 快速裁切适配各大社交与设计标准比例 (`1:1`, `16:9`, `9:16`, `4:3`, `3:2`, `2:3`)，支持自动对焦、三分法构图 (`rule_of_thirds`) 与黑边留白 (`letterbox`)。
* **品牌资源套件导出器 (`export_asset_pack`)**: 一键生成生产级网站与 PWA 资源套件：SVG Favicon、PWA 推荐图标套件 (`icon-192.svg`, `icon-512.svg`)、`manifest.webmanifest`、1200×630 社交分享预览卡片 (`og-card.svg`) 与索引 `catalog.json`。
* **覆盖 12 大视觉工具的交互 Toolview**: 在对话中直接提供重混、放大、裁切与栅格拼图的可视化操作。
* **严谨的中英双语界面**: 完整的 `zh` 和 `en` 词典覆盖。

## 🚀 更新 v0.10.19: 侧边栏内置图库、连接诊断与风格引擎 (#224)
* **原生侧边栏图库与历史抽屉**: 直接集成至 DSH 原生右侧面板 (`sidebarRightTabs` 与 `sidebar.right.pane.tab`)、`betterSidebar`，并在对话会话顶部标题栏中新增快捷入口按钮 (`conversation.session.header.utilities`)。支持浏览历史生成、参数详情查看、一键复制提示词与 Markdown 链接。
* **交互式提供商连接诊断**: 在设置卡片的“提供商”标签页新增“测试连接”按钮。实时检测 Fal.ai、ComfyUI、Automatic1111 或自定义 OpenAI 兼容接口的网络连通性与往返延迟。
* **精选风格预设与提示词增强引擎**: 内置 10 款精心调校的艺术与摄影预设风格 (`cinematic`, `photorealistic`, `anime`, `minimalist_vector`, `isometric_3d`, `analog_film`, `cyberpunk`, `pixel_art`, `oil_painting`, `claymation`)，支持 `autoEnhancePrompt` 自动强化与 `style_preset` 工具参数。
* **拼图与多图对比拼接工具 (`assemble_image_grid`)**: 将 2 至 4 张图像拼接为整齐紧凑的并排对比、2x2 网格或垂直长图，采用纯 Node.js SVG 矢量容器渲染，无需笨重外部二进制依赖（包体积严格保持在 250 KiB 以下）。
* **品牌色板约束生成**: 在 `generate_image` 中传入 `palette_colors` (十六进制色值数组)，算法级引导正向与反向提示词紧密贴合特定色系，并提供 WCAG 对比度校验。
* **局部重绘与遮罩编辑 (`edit_image`)**: 新增 `mask_image` 遮罩支持与精细 `strength` (0.0 至 1.0) 去噪强度调节。
* **完整中英文界面语言包**: Web 界面全面支持 `zh` 和 `en` 语言。

## 🚀 v0.10.4 更新：Cordis 生命周期、完整设置界面与国际化
- **Cordis 生命周期 (#136)**：将所有 7 个工具注册包装在 `ctx.effect` 中，以便在热重载时正常释放。
- **设置界面完整性 (#137)**：添加了 Replicate、SeaDream、Gemini、本地 ComfyUI/A1111、风格预设和 LLM 增强器的配置字段。
- **包清单依赖 (#138)**：在 `peerDependencies` 中补齐了内核服务依赖。
- **React 组件优化 (#139)**：从 `FalImageCard` 中移除了未使用的无用状态。
- **全面国际化 (#140)**：消除了硬编码文本，为中、英、俄语提供完整翻译。

## 📦 安装

```bash
dsh plugin --profile web add @goodandready/dsh-image-gen
```

---

## 📄 许可证

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY)
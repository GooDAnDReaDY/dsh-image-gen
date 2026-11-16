# 📦 @goodandready/dsh-image-gen

**当前版本：`0.12.37`**（与 `package.json` 同步，#563）

> 面向 DeepSeek Harness 的多提供商图像生成与视觉处理套件：智能体可通过 50 个工具（`all` 配置文件；3 个在 `minimal`；启用可选工具集最多 66 个）完成文本生图、编辑、去背、放大、矢量化、多参考融合与质量检查，覆盖 8 个生成后端。

---

## 🚀 亮点功能

- **输入框生图服务胶囊 (`showProviderPill`, #501/#519)**：挂载于 `conversation.input.right` 插槽，无需离开聊天即可快速切换生图提供商与模型；可在设置的“常规”标签页中隐藏。
- **交互式 A/B 对比滑块 (#499)**：支持鼠标与触控的“前后对比”分割滑块，用于面部修复、局部重绘、风格重混的直观对比。
- **版本历史轮播 (#500)**：卡片内 `< v1 / N >` 版本导航，浏览器 `localStorage` 本地持久化（每张卡片上限 20 个版本）。
- **交互式生成审批闸门 (#450)**：计费生成前在聊天中展示计划（提示词、提供商、预估费用）并等待确认；超时或取消不产生任何费用。
- **重侧边栏 Image Studio 工作台 (#452/#453)**：原生右侧边栏生图面板，样式自动补全、负面提示词、透明度选择器与最近图像网格；会话级资产归档与语义命名。
- **消息卡片内修改提示词重新生成 (#502)**：点击 `🔄 Regenerate…` 修改提示词并选择保持或刷新随机种子。

---

## 📦 安装

```bash
dsh plugin add @goodandready/dsh-image-gen
```

支持提供商：**FAL (fal.ai)**、**Google Gemini / Imagen**、**OpenAI DALL-E / Images API**、**Replicate**、**Seedream (字节跳动)**、**自定义 OpenAI 兼容网关**、**本地 ComfyUI**、**Automatic1111 (Stable Diffusion WebUI)**，以及无需 API Key 的 **DSH Subscription Images**。

---

## 🧭 工具集配置 (toolsetProfile)

| 配置文件 | 工具数量 | 说明 |
|---|---|---|
| `minimal`（默认） | 3 | `generate_image`、`edit_image`、`inspect_image_quality`，节省约 8,000 提示词 token |
| `all` | **50** | 以下完整注册表 |
| `all` + 可选工具集 | **66** | 追加 recipes / capabilities / profiles / staging / queue / variants / lineage / designExport |
| `custom` | 任意 | 由设置中的布尔开关精细控制 |

---

## 🛠️ 完整工具注册表（50 个）

### 核心生成（4）
| 工具 | 说明 |
|---|---|
| `generate_image` | 文本生图，支持比例、质量、参考图锚定与负面提示词 |
| `generate_image_pack` | 多比例打包（1:1、16:9、9:16 等） |
| `vary_image` | 保留构图的可控变体生成 |
| `remix_image` | 可控重混，支持去噪强度、样式与几何保持 |

### 编辑与增强（11）
| 工具 | 说明 |
|---|---|
| `edit_image` | 定向编辑 / inpainting，自动上下文检索原图 |
| `upscale_image` | 2x/4x 分辨率放大 |
| `remove_background` | 背景移除，输出透明 PNG |
| `compare_images` | 逐像素对比两张图像 |
| `blend_images` | 多图加权融合 |
| `vectorize_image` | 位图矢量化（SVG），自适应调色板 |
| `smart_crop_image` | 智能裁切至标准比例（`auto_focus`、`rule_of_thirds`、`letterbox`） |
| `assemble_image_grid` | 2–4 张图像合成对比网格（纯 SVG） |
| `outpaint_image` | 方向性画布扩展与背景续写 |
| `async_generate_image` | 异步生成管线（`task_id` + 轮询） |
| `generate_with_control` | ControlNet 结构控制（`canny`/`depth`/`pose`/`sketch`） |

### 创意与 Web 资产（6）
| 工具 | 说明 |
|---|---|
| `generate_ui_asset` | 图标 / 贴纸 / Hero 横幅，负空间构图 + 透明背景 |
| `generate_theme_pair` | 亮/暗主题成对生成 + 响应式 HTML/CSS 片段 |
| `generate_spritesheet` | 精灵图集与 CSS 动画 |
| `generate_pwa_icons` | 完整 PWA 图标规格 + manifest |
| `generate_seamless_pattern` | 无缝平铺图案 |
| `search_inspiration_prompts` | 内置 970+ 离线灵感提示词目录 |

### 工作室与连续性（11）
| 工具 | 说明 |
|---|---|
| `set_style_anchor` | 会话级角色 / 风格 / 面部锚定 |
| `render_wireframe_asset` | 线框 → 高保真设计稿（设计系统预设） |
| `generate_character_sheet` | 多角度角色设定表 |
| `generate_style_matrix` | 2×2 风格矩阵 + 盲评对比 |
| `generate_image_matrix` | 种子/CFG 变体矩阵 |
| `generate_turnaround_sheet` | 三视图转身表（自动切片） |
| `reverse_prompt_and_recreate` | 反推提示词并重建 |
| `deep_reverse_prompt` | 深度摄影光学反推（三档深度） |
| `generate_seamless_texture` | 无缝纹理（3×3 检查网格） |
| `compare_models_matrix` | 多模型横评 + Sharp 联络表 |
| `generate_ecommerce_pack` | 电商四镜头产品包 |

### 视觉与本地化（7）
| 工具 | 说明 |
|---|---|
| `inspect_image_quality` | 清晰度/空白检测 + 期望元素视觉核验 |
| `replace_image_text` | 图内文字替换（OCR + inpainting + 字体重排） |
| `translate_image_text` | 图内文字翻译（俄/英/中） |
| `restore_face_and_details` | 面部与高频细节修复 |
| `beautify_diagram` | Mermaid/Graphviz → 3D 等距图表美化 |
| `generate_drawio_diagram` | 可编辑 Draw.io / mxfile 架构图 + SVG 预览 |
| `extract_comfy_workflow` | 提取 PNG 内嵌 ComfyUI 工作流 |

### 前端与设计资产（5）
| 工具 | 说明 |
|---|---|
| `extract_design_tokens` | 主色/语义色 → CSS 变量 / Tailwind / W3C JSON |
| `image_to_css_gradient` | 图像 → 轻量 CSS 网格渐变 |
| `check_image_contrast` | WCAG 对比度与 scrim 叠加 |
| `optimize_vector_svg` | SVG 清理、规范 viewBox、导出 React TSX |
| `export_asset_pack` | 完整 Web/PWA 资产包 |

### 工作区与画布（4）
| 工具 | 说明 |
|---|---|
| `save_image_to_workspace` | 内容寻址工作区导出 |
| `canvas_state` | 无限画布状态检查 |
| `view_canvas` | 画布选区物化为对话附件 |
| `compose_baoyu_prompt` | Baoyu 五维风格/构图提示词装配器 |
| `sketch_to_image` | 草图上色成图 |
| `generate_responsive_mockups` | Mobile/Tablet/Desktop 自适应三件套 |

### 可选工具集（+16，共 66）
| 工具 | 工具集 | 说明 |
|---|---|---|
| `run_image_recipe` / `manage_image_recipes` | recipes | 顺序多步配方管线 |
| `validate_comfy_workflow` | recipes | ComfyUI 工作流预校验 |
| `select_image_model` / `validate_model_features` | capabilities | 能力注册表推荐与预检 |
| `manage_project_profiles` / `resolve_project_profile_params` | profiles | 项目视觉档案 |
| `stage_image_edit` / `review_staged_edit` | staging | inpaint 暂存与安全评审 |
| `enqueue_batch_jobs` / `manage_batch_queue` | queue | 持久化批量队列 |
| `evaluate_image_variants` / `select_variant_winner` | variants | 变体评估与胜者选择 |
| `inspect_image_lineage` / `get_image_replay_payload` | lineage | 血缘 DAG 与可复现载荷 |
| `export_design_asset` | designExport | Figma/Penpot/OpenDesign 导出 |

---

## 🛡️ 安全性

- **路径隔离**：`resolveSource`/`resolveConversationImage` 经 `fs.realpath` 规范化，symlink 越界立即拒绝。
- **SSRF 防护**：提供商 Base URL 与返回的下载 URL 均验证协议/凭据/云元数据/内网地址；下载 100 MB 封顶。
- **路由策略**：全部 HTTP 路由按 `isTrustedLocalRequest` / 会话认证 / CSRF（Origin、`Sec-Fetch-Site`）分级防护；SSE 不发送通配 CORS。
- **环回限制**：一键更新端点仅接受 loopback/私有网段 + `x-dsh-plugin-update: 1` + 同源。
- **请求体限额**：所有变更端点读取请求体均有 64 KiB–15 MB 上限并返回 413。
- **Fail-Closed**：`enabled: false` 时所有工具立即拒绝执行，不发起任何网络请求。

---

## 📄 更新历史（节选）

- **v0.12.26 (#519)**：输入框生图服务切换按钮显隐设置。
- **v0.12.21 (#501/#502)**：输入框生图服务胶囊与卡片内重新生成模态框。
- **v0.12.20 (#499/#500)**：交互式 A/B 对比滑块与持久化版本轮播。
- **v0.12.12 (#452/#453)**：右测边栏 Image Studio 工作台与会话资源归档。
- **v0.12.8 (#450)**：交互式生成审批闸门。

完整英文/俄文变更记录见 `README.md` / `README.ru.md`。

---

## 📄 许可证

MIT — 见 [LICENSE](LICENSE)。

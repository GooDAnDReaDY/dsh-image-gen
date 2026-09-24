---
name: image-generation
description: Use when generating, editing, or validating visual assets with @goodandready/dsh-image-gen. Best practices for prompts, aspect ratios, responsive packs, spritesheets, UI assets, and theme pairs.
---

# Image Generation & Visual Assets Skill

Authoritative agent guide for creating, editing, and validating visual assets using `@goodandready/dsh-image-gen`.

---

## 1. Tool Selection Guide

Choose the specialized tool that fits the exact design objective rather than defaulting to generic `generate_image`:

| Objective | Recommended Tool | Key Parameters |
| :--- | :--- | :--- |
| General text-to-image | `generate_image` | `prompt`, `aspect_ratio`, `style_preset`, `seed` |
| UI & Web Graphic (Icons, Heroes, Badges) | `generate_ui_asset` | `asset_type`, `layout`, `padding_ratio`, `transparent_background` |
| Dark / Light Theme Pair | `generate_theme_pair` | `prompt`, `aspect_ratio`, `dark_contrast_boost`, `style` |
| 2D Game Animation or Micro-interactions | `generate_spritesheet` | `prompt`, `frames` (4-12), `animation_phase`, `frame_size` |
| Seamless Repeating Textures & Backdrops | `generate_seamless_pattern` | `prompt`, `pattern_type`, `tile_scale` |
| Guided Layout Synthesis from Wireframe/Lines | `sketch_to_image` | `sketch`, `prompt`, `strength`, `sketch_type` |
| Creative Exploration & Style Benchmarking | `generate_style_matrix` | `prompt`, `styles` (4 diverse styles) |
| Non-destructive Cropping & Reframing | `smart_crop_image` | `image`, `target_aspect`, `focus_area` |
| Production PWA & Favicon Bundle | `export_asset_pack` | `image`, `output_name`, `generate_pwa_icons` |
| Iterative Variation & Style Blending | `remix_image` | `image`, `creativity`, `polish_prompt` |
| Character / Aesthetic Consistency Anchor | `set_style_anchor` | `anchor_name`, `visual_directives`, `palette` |

---

## 2. Prompt Engineering Standards

### Structural Prompt Formula
```
[Subject & Primary Action] + [Environment & Context] + [Lighting & Atmosphere] + [Art Medium & Rendering Technique] + [Composition & Negative Space]
```

### Best Practices:
1. **Be Concrete**: Avoid vague words like "photorealistic" or "hyper-detailed". Specify physical traits: "subsurface scattering, 85mm portrait lens, f/1.8 aperture, cinematic volumetric god rays, subtle specular highlights".
2. **Control Negative Space for UI**: When generating graphics for web headers or cards, use `generate_ui_asset` with explicit composition directives (`left_empty`, `right_empty`, `isolated`).
3. **Palette & Color Harmonization**: Provide 2-3 dominant color hex codes or palettes (e.g. "warm terracotta and muted sage with deep charcoal contrast").
4. **Style Consistency**: When building multi-image narratives or consistent UI sets, call `set_style_anchor` first to lock the visual DNA across all subsequent calls.

---

## 3. Aspect Ratio Selection Reference

| Aspect Ratio | Exact Dimensions | Optimal Use Case |
| :--- | :--- | :--- |
| `1:1` | 1024×1024 | Avatars, social profile icons, app icons, square product cards |
| `16:9` | 1344×768 | Web hero sections, video covers, presentation slides, landscape scenery |
| `9:16` | 768×1344 | Mobile splash screens, Stories, TikTok/Shorts vertical backdrops |
| `4:3` | 1152×864 | Editorial illustrations, blog post thumbnails, tablet banners |
| `3:4` | 864×1152 | Portrait book covers, character sheets, fashion lookbooks |
| `21:9` | 1536×640 | Ultra-wide cinematic headers, panoramic website landing banners |

---

## 4. UI Asset & Theme Synchronization

### Dual Theme Adaptation (`generate_theme_pair`)
When designing for interfaces with dark mode support:
- Light theme requires clean white/light neutral backdrop (`#FFFFFF` or `#F8FAFC`), crisp silhouettes, and soft ambient occlusion shadows.
- Dark theme requires deep slate/obsidian backdrop (`#0F172A` or `#18181B`), luminous edge lighting, and elevated contrast.
- Always output clean `<picture>` tags with `(prefers-color-scheme: dark)`:
```html
<picture>
  <source srcset="dark-asset.webp" media="(prefers-color-scheme: dark)">
  <img src="light-asset.webp" alt="Feature Graphic" loading="lazy">
</picture>
```

---

## 5. Iterative Refinement & Validation

1. **Inpainting Canvas**: For minor localized errors (e.g., distorted hands, unwanted background artifacts), use the in-chat inpainting canvas tool or pass a binary mask to `generate_image` with `strength: 0.65-0.75`.
2. **Quality Verification**: When generating critical brand assets, evaluate the result with `inspect_image_quality` or `dsh-vision-bridge` to verify sharpness, artifact score, and WCAG text contrast compatibility.
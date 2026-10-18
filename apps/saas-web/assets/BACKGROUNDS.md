# 创作区背景资产

生成方式：内置 image_gen。用于 UI 背景层，无文字、按钮或内容插图；界面交互由 HTML/CSS 实现。原始 PNG 位于 G:/Projects/Pi-Agent-Hypite/output/ui-images/source。

- [creation-atmosphere-dark.webp](creation-atmosphere-dark.webp)：1536 × 1024，41 KiB。
- [creation-atmosphere-light.webp](creation-atmosphere-light.webp)：1536 × 1024，28 KiB。

## creation-atmosphere-dark

Use case: stylized-concept. Generate a BACKGROUND TEXTURE asset for the full-width first screen of a refined video-creation web app, not an illustration card. Landscape 3:2 master that can be cropped to a panoramic 2.4:1 UI backdrop. Entire canvas is a continuous immersive near-black charcoal surface, with a large soft pool of copper and burnt amber light blooming from the upper middle and fading gently toward all edges. Very subtle smoky volumetric light and beautifully imperfect satin-metal micrograin, like a real cinematic studio light spilling across a dark tactile surface. Broad soft transitions, extremely restrained detail; sophisticated spatial atmosphere. Most pixels remain dark enough for white UI text. Central 60% must be quiet and free of sharp edges because a live input panel will overlay it. All four edges fade to almost-black charcoal #111114, bottom third especially dark. A faint warm brushed texture can appear toward upper corners. No objects, no bottles, no products, no landscapes, no panels, no rectangles, no frames, no interface elements, no lines resembling controls, no typography, no logo, no symbols, no watermark, no bright glowing orb. This is the environmental visual material of the UI itself, an elegant ambient background.

## creation-atmosphere-light

Use case: stylized-concept. Generate a BACKGROUND TEXTURE asset for the full-width first screen of a refined video-creation web app in LIGHT THEME, not an illustration card. Landscape 3:2 master intended to crop to panoramic 2.4:1. Continuous ivory and pale warm stone surface, an extremely soft champagne and muted copper daylight wash across the upper center with barely perceptible satin-metal grain, and gentle ambient shadows near the outer top edges. Premium tactile art direction, soft luminous material, calm and spacious, delicate real-world optical imperfections instead of a perfect computer gradient. Central 60% quiet for live dark UI text and a white input panel to overlay later. All four edges softly dissolve into off-white #faf9fc, bottom third nearly plain off-white. Low contrast, no dark patches, no visual objects, no folded sheets, no products, no landscape, no panels, no card shapes, no rectangles, no interface elements, no text, no logos, no symbols, no watermark. This is the atmospheric material behind an interactive creative workspace, complementary to a charcoal/copper dark theme.
## 页面接入与验证

tokens.css 按主题选择背景，style.css 将其放在首页 .studio-shell::before，使用 pointer-events:none 与遮罩渐隐；切换路由后移除背景。页面标题、表单与按钮为真实 HTML，无文字烧录在图像里。背景加载失败时仍有 canvas 底色，控件保持可用。

开发静态白名单与 scripts/build-saas-web.mjs 均已纳入这两张背景。2026-10-18：4320 响应、源码与构建资源逐字节一致；双主题桌面/平板/手机布局和真实参考导入通过。具体证据见 docs/verification.md 当前章节。

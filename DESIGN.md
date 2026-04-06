# Design System — voss

## Product Context
- **What this is:** Self-hosted Vercel clone. CLI + web dashboard for deploying JS apps to your own VPS.
- **Who it's for:** Developers who want Vercel DX on their own infrastructure.
- **Space/industry:** Developer tools, self-hosted PaaS, deployment platforms.
- **Project type:** CLI tool + web app (dashboard/admin)

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian
- **Decoration level:** Minimal — typography and status dots do all the work
- **Mood:** Professional, precise, trustworthy. Like a well-built terminal with good typography. The user should feel they are using a serious tool, not a toy.
- **Reference sites:** Vercel dashboard, Linear, GitHub dark mode

## Typography
- **Display/Hero:** Geist — Vercel's typeface. Industrial, clean, professional. Perfect for a deployment tool.
- **Body:** Geist — single font family for all UI text. Consistency over variety.
- **UI/Labels:** Geist (same as body)
- **Data/Tables:** Geist Mono — for deploy hashes, URLs, timestamps, file paths, log output. Must support tabular-nums.
- **Code:** Geist Mono
- **Loading:** Google Fonts CDN (`https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700` + Geist Mono)
- **Scale:** 12px (caption/muted), 13px (body small), 14px (body), 16px (subtitle), 20px (title), 24px (page heading), 32px (hero)

## Color
- **Approach:** Restrained — one accent + neutrals. Color is rare and meaningful.
- **Background:** #0a0a0a — near-black, easy on the eyes
- **Surface:** #141414 — cards, sidebar, elevated elements
- **Border:** #262626 — subtle separation
- **Text:** #ededed — primary text
- **Muted:** #666666 — secondary text, timestamps, metadata
- **Accent:** #0070f3 — links, active states, primary buttons
- **Accent hover:** #0060df
- **Success:** #0cce6b — live deployments, health checks passed
- **Warning:** #f5a623 — building, pending SSL, attention needed
- **Error:** #ee5253 — failed deploys, health check failures
- **Info:** #0070f3 — same as accent
- **Dark mode:** This IS the dark mode. No light mode planned for v0.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — not cramped, not spacious. Data-dense but readable.
- **Scale:** 2xs(2px) xs(4px) sm(8px) md(16px) lg(24px) xl(32px) 2xl(48px) 3xl(64px)
- **Component spacing:** 8px between related items, 16px between sections, 24px between major sections

## Layout
- **Approach:** Grid-disciplined — strict columns, predictable alignment
- **Grid:** Sidebar (240px fixed) + content (fluid). Content uses 12-column grid on desktop.
- **Max content width:** 1200px
- **Border radius:** none(0) sm(4px) md(6px) lg(8px) full(9999px for pills/avatars)
- **Sidebar:** Fixed left, 240px wide. Collapsible on tablet/mobile.

## Motion
- **Approach:** Minimal-functional — only transitions that aid comprehension
- **Easing:** ease-out for enter, ease-in for exit
- **Duration:** 100ms for hover states, 200ms for expand/collapse, 0ms for page navigation (instant SPA)
- **No decorative animations.** No entrance animations. No scroll effects. Status changes are instant (dot color changes immediately).

## CLI Design
- **Colors:** 16-color mode only (green, red, yellow, cyan, dim, bold). No RGB/256 colors.
- **Output structure:** Detection → Upload → Build (streaming) → Health check → URL
- **Success marker:** ✓ (green)
- **Error marker:** ✕ (red)
- **Progress:** Spinner for active operations. No progress bars.
- **Monospace everything.** CLI is a terminal tool, all output is monospace.

## Component Patterns
- **No cards.** Use rows/lists with subtle borders for separation.
- **No shadows.** Flat surfaces differentiated by background color only.
- **No gradients.** Solid colors only.
- **Status indicators:** Colored dots (8px circles). Green/yellow/red/gray.
- **Buttons:** Primary (accent bg, white text), secondary (transparent, border, text), ghost (no border, text only).
- **Inputs:** Dark background (#141414), subtle border (#262626), white text. Focus: accent border.
- **Tables:** Row-based, alternating row bg subtle (#0f0f0f / #141414). Monospace for data columns.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-06 | Initial design system created | Industrial/Utilitarian with Geist font, dark theme, Vercel-inspired color palette. Created by /design-consultation. |
| 2026-04-06 | Single font family (Geist + Geist Mono) | Coherence over variety. One less decision for every component. |
| 2026-04-06 | No light mode for v0 | Developer tools audience prefers dark. Simplifies implementation. |
| 2026-04-06 | 16-color CLI only | Maximum terminal compatibility. No broken output on minimal terminals. |
| 2026-04-06 | No cards, no shadows, no gradients | Industrial aesthetic. Data density. Anti-slop. |

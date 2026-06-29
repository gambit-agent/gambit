---
name: Gambit CLI
description: Terminal-based AI agent development environment — confident, opinionated, warm.
colors:
  blossom: "#FFB6C1"
  ink: "#131313"
  panel: "#141414"
  header-surface: "#181818"
  mist: "#C9D1D9"
  ash: "#4D4E4E"
  border-header: "#292929"
  border-body: "#222222"
  border-divider: "#1F2940"
  user-bg: "#1B1B1B"
  user-fg: "#FFFFFF"
  error: "#FF6B6B"
  error-bg: "#3A1F1F"
  success: "#7EE787"
  success-bg: "#16351F"
  info: "#79C0FF"
  selected-bg: "#1A1A1A"
  reasoning-bg: "#1C1C1C"
  tool-bg: "#321F33"
  tool-border: "#9B73AA"
  input-bg: "#0F1726"
  input-border: "#808080"
  input-focused-bg: "#141414"
  code-inline-bg: "#26313A"
  code-inline-fg: "#F4D3DD"
  code-block-bg: "#171B22"
  code-block-fg: "#D6DEEB"
  code-block-border: "#344054"
  code-block-accent: "#79C0FF"
  diff-added: "#3FB950"
  diff-removed: "#F85149"
  diff-line-number: "#8B949E"
  link: "#8CB4FF"
  link-secondary: "#5C719B"
  response-strong: "#F0C6D0"
typography:
  body:
    fontFamily: "monospace"
    fontWeight: 400
    lineHeight: 1
  heading:
    fontFamily: "monospace"
    fontWeight: 700
    lineHeight: 1
  label:
    fontFamily: "monospace"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "normal"
spacing:
  screen-padding: "1"
  section-gap: "1"
  panel-gap: "1"
  panel-padding-x: "2"
  panel-padding-y: "1"
  status-gap: "2"
  message-padding-x: "2"
  message-padding-y: "1"
  markdown-block-gap: "1"
  input-row-min-height: "3"
components:
  header:
    backgroundColor: "{colors.header-surface}"
    textColor: "{colors.blossom}"
    padding: "1 0 1 0"
  footer-segment:
    textColor: "{colors.ash}"
    padding: "1 1 0 1"
  composer:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.user-fg}"
    padding: "0 1 0 1"
    height: "{spacing.input-row-min-height}"
  message-assistant:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.mist}"
    padding: "{spacing.message-padding-y} {spacing.message-padding-x}"
  message-user:
    backgroundColor: "{colors.user-bg}"
    textColor: "{colors.user-fg}"
    padding: "{spacing.message-padding-y} {spacing.message-padding-x}"
  message-tool:
    backgroundColor: "{colors.tool-bg}"
    textColor: "{colors.blossom}"
    padding: "{spacing.message-padding-y} {spacing.message-padding-x}"
  reasoning-block:
    backgroundColor: "{colors.reasoning-bg}"
    textColor: "{colors.blossom}"
    padding: "0 1 0 1"
  popup-overlay:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.mist}"
    width: "60"
  popup-overlay-large:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.mist}"
    width: "88"
  permission-prompt:
    backgroundColor: "{colors.header-surface}"
    textColor: "{colors.blossom}"
    padding: "0 2 0 2"
    width: "90"
---

# Design System: Gambit CLI

## 1. Overview

**Creative North Star: "The Warm Instrument"**

Gambit is a confident, opinionated tool that's not afraid to be itself. The pink accent (`#FFB6C1`) is a signature, not a decoration — it says "this tool has personality" without shouting. Like a well-themed editor that feels alive. The terminal is the medium; Gambit embraces its constraints rather than fighting them.

This is a product register: design serves the developer's workflow. Every visual element earns its pixels by carrying signal — status, state, role, focus. The system rejects three things explicitly: **generic terminal drab** (dense monochrome walls with no visual hierarchy), **web-app mimicry** (fake shadows, pseudo-windows, rounded boxes fighting the character grid), and **over-designed SaaS-in-terminal** (too many colors, bloated chrome wasting terminal rows on decoration).

The system ships 13 themes, but only two are Gambit's own: `gambit-dark` (the default) and `gambit-light`. The remaining 11 are familiar editor themes (GitHub, Dracula, One Dark, Monokai Pro, Solarized, Nord, Tokyo Night, Gruvbox, Catppuccin) offered as user-selectable alternatives. The brand identity lives in the Gambit themes; the others are courtesy.

**Key Characteristics:**
- Monospace-native: every element aligns to the character grid; no fractional positioning
- Single-accent discipline: Blossom (`#FFB6C1`) is the only brand color, used for focus, prompts, borders, and active states
- Tonal depth: background → panel → header creates hierarchy through 1-2 step luminance shifts, not shadows
- Attribute-driven hierarchy: BOLD for emphasis, DIM for de-emphasis; no font-size variation (terminal cells are uniform)
- Tactile components: rounded borders, accent-colored prompts (`›`), visible state indicators — components feel like physical objects

## 2. Colors: The Gambit Palette

A single-accent system on a near-black canvas. Blossom carries the brand; the neutrals do the heavy lifting.

### Primary

- **Blossom** (#FFB6C1): The signature. Used on the logo, composer prompt (`›`), active/selected text, reasoning block text and border, tool message text, warning indicator, link-accented elements, and the `›` focus marker in pickers. Blossom appears wherever the eye should go first. It is never used as a background fill — always as foreground, border, or accent.

### Secondary

- **Response Strong** (#F0C6D0): A lighter, desaturated Blossom used for emphasized assistant text (bold inline within responses). Provides a second tier of emphasis without introducing a new hue.

### Tertiary

- **Tool Border** (#9B73AA): A muted purple that distinguishes tool-call containers from regular borders. Only appears on tool message backgrounds as a border accent.
- **Info** (#79C0FF): A cool blue for informational text, links in light context, and code-block syntax accents. Secondary to Blossom in the accent hierarchy.

### Neutral

- **Ink** (#131313): The canvas. The deepest layer. Never used as text — always as background.
- **Panel** (#141414): One step above Ink. Used for popup/overlay backgrounds.
- **Header Surface** (#181818): Two steps above Ink. Used for the header bar and permission prompt background.
- **Mist** (#C9D1D9): Primary body text color. Cool silver with sufficient contrast against Ink.
- **Ash** (#4D4E4E): Muted text — status labels, timestamps, de-emphasized metadata. The quietest visible text; anything dimmer is invisible.
- **User Background** (#1B1B1B): Slightly lighter than Ink to distinguish user messages from the canvas.
- **Border Header** (#292929): Subtle border for the header bar.
- **Border Body** (#222222): Standard border for body-level containers (composer, message wrappers).
- **Border Divider** (#1F2940): A cooler-toned divider used for the input area — the only border with a blue tint, signaling the interaction zone.

### Semantic

- **Error** (#FF6B6B) / **Error Background** (#3A1F1F): Failure states, failed tool calls, context-usage overflow above 85%.
- **Success** (#7EE787) / **Success Background** (#16351F): Completed tool calls, active theme marker (`*`), diff added lines.
- **Warning** (#FFB6C1): In gambit-dark, warning shares Blossom — the accent pulls double duty. This is intentional; warnings are warm.
- **Diff Added** (#3FB950) / **Diff Removed** (#F85149) / **Diff Line Number** (#8B949E): Standard git diff coloring, independent of the brand palette.

### Code

- **Code Inline Background** (#26313A) / **Code Inline Foreground** (#F4D3DD): Inline code spans within markdown — a dark teal bg with a warm pink-tinted foreground that ties back to Blossom.
- **Code Block Background** (#171B22) / **Code Block Foreground** (#D6DEEB) / **Code Block Border** (#344054) / **Code Block Accent** (#79C0FF): Fenced code blocks — a darker surface than the canvas, with a cool blue accent for syntax highlighting.

### Named Rules

**The One Accent Rule.** Blossom (`#FFB6C1`) is the only brand color. It appears on focus, prompts, active selection, reasoning, and the logo — never as a background fill, never as decoration. If a new surface needs color, ask whether it's signaling state. If not, it doesn't get Blossom.

**The Warm Warning Rule.** In gambit-dark, warning uses Blossom rather than a separate yellow/amber. This is intentional — Gambit's warnings are warm, not alarming. Do not introduce a separate warning hue unless the theme explicitly defines one.

**The Ash Floor Rule.** Ash (`#4D4E4E`) is the quietest text that remains readable. Any text dimmer than Ash is invisible against Ink and is prohibited. If something needs to be de-emphasized further, remove it — don't dim it into nothing.

## 3. Typography

**Font:** Terminal monospace (inherited from the user's terminal — no custom font family)

**Character:** One family, three voices. The hierarchy is built entirely on text attributes — BOLD for emphasis, DIM for de-emphasis, UNDERLINE for links. There are no font sizes in a TUI; every character occupies one terminal cell. This constraint is the aesthetic: density without clutter, hierarchy through weight, not size.

### Hierarchy

- **Heading** (700, 1cell, lineHeight 1): All markdown headings (H1–H6) map to BOLD. No size differentiation between heading levels — the terminal doesn't support it. Hierarchy is conveyed through surrounding spacing, not font size.
- **Body** (400, 1cell, lineHeight 1): Default text. Mist (`#C9D1D9`) on Ink (`#131313`) for assistant messages. White on User Background for user messages.
- **Label** (400, 1cell, DIM): Status text, timestamps, metadata, keyboard hints. Ash (`#4D4E4E`) on Ink. Always paired with DIM attribute — the color and attribute work together.

### Named Rules

**The Attribute-Only Hierarchy Rule.** Never introduce a second font family. Hierarchy is BOLD > regular > DIM, in that order. If something needs more emphasis than BOLD, add color (Blossom). If it needs less than regular, add DIM. There is no fourth tier.

**The Monospace Alignment Rule.** Every element must align to the character grid. Tables, code blocks, diff views, and message padding all respect cell boundaries. Never use proportional spacing, fractional positions, or sub-cell rendering — the terminal doesn't support it, and misaligned output looks broken.

## 4. Elevation

This system has no shadows. Depth is conveyed through two mechanisms: **tonal layering** and **backdrop dimming**.

Tonal layering creates a 3-step hierarchy through subtle background luminance shifts: Ink (`#131313`, the canvas) → Panel (`#141414`, popups) → Header Surface (`#181818`, header and permission prompts). Each step is 1–2 luminance values apart — enough to distinguish, not enough to distract. The eye reads the hierarchy without conscious effort.

Backdrop dimming is reserved for overlays. When a popup, picker, or permission prompt appears, the entire screen behind it is dimmed with a semi-transparent black wash (`rgba(0,0,0,150)`). This creates a clear depth separation — the overlay is above, the conversation is below — without inventing shadows that the terminal can't render.

### Shadow Vocabulary

No CSS box-shadows. The "elevation" tokens are:

- **Tonal step 1** (Panel `#141414` vs Ink `#131313`): Popup backgrounds. One step above the canvas.
- **Tonal step 2** (Header Surface `#181818` vs Ink `#131313`): Header bar and permission prompts. Two steps above the canvas.
- **Backdrop dim** (`rgba(0,0,0,150)`): Overlay backdrop. Creates depth separation for modals without shadows.

### Named Rules

**The No-Shadow Rule.** Never use CSS box-shadow, text-shadow, or any shadow-like effect. The terminal is a flat medium. Depth comes from background color and border weight, never from simulated light. If a surface needs to feel "raised," give it a lighter background — not a shadow.

**The Border-Weight Ladder Rule.** Border styles encode importance: `rounded` for the composer (the primary interaction surface), `heavy` for permission prompts (high-stakes, demands attention), single-line for standard containers, and custom `▌` left-border for reasoning blocks (visually distinct, signals "internal monologue"). Never use the same border style for two different importance levels.

## 5. Components

Each component leads with a character line, then specifies shape, color, states, and behavior.

### Header

The top bar. Brand presence without decoration.

- **Shape:** Full-width row, no border. Padding top/bottom 1 row.
- **Primary:** Bold Blossom text — `GAMBIT | v{version} |` followed by a DIM timestamp in Ash.
- **Right side:** Workspace path in DIM Ash.
- **States:** Static — no hover or focus states.

### Footer

The status bar. Information density at a glance.

- **Shape:** Full-width row, no border. Padding X 1, top 1.
- **Segments:** Dot-separated (` · `) status segments. Each segment carries its own color. Segments joined by DIM Ash dots.
- **Right cluster:** Model name in Blossom, followed by context usage ratio. Context usage color-codes by threshold: Ash (<60%), Warning/Blossom (60–85%), Error (›85%).
- **States:** Color shifts on context pressure (Ash → Warning → Error). No hover states.

### Composer

The input box. The primary interaction surface — must feel tactile and inviting.

- **Shape:** Rounded border on all four sides. Border color: Border Body (`#222222`).
- **Prompt:** `› ` in BOLD Blossom. The signature marker — instantly recognizable as "type here."
- **Background:** Ink (`#131313`). Same as canvas, but the rounded border creates separation.
- **Textarea:** User Foreground (`#FFFFFF`) text. Placeholder in Ash. Cursor color in Blossom.
- **States:** Focused background stays Ink (no color shift on focus — the cursor and border already signal focus). Slash completion and file mention overlays appear inline above the textarea when triggered.

### Messages

Conversation messages, color-coded by role. Each role has a distinct background/foreground pair.

- **Assistant:** Ink background, Mist foreground. The default reading surface — recedes into the canvas.
- **User:** User Background (`#1B1B1B`), White foreground. Slightly raised from the canvas to distinguish user input.
- **Tool:** Tool Background (`#321F33`, a dark muted purple), Blossom foreground. Visually distinct from both user and assistant — the purple tint signals "tool action."
- **Tool heading:** `• ` bullet in status color (Success for completed, Error for failed, Blossom for started), followed by tool name in Blossom, detail in DIM Ash.
- **Tool detail lines:** `└` tree character in White, followed by key in Blossom, value in DIM Ash.
- **System:** System Background (`#1A2236`, a dark blue), System Foreground (`#B2C3F0`). Cool-toned to separate system messages from conversation.

### Reasoning Block

Collapsible internal-monologue display. The most distinctive visual pattern in the system.

- **Shape:** Left-border only. Custom border character: `▌` (left half block) on all sides — creates a solid vertical bar effect.
- **Background:** Reasoning Background (`#1C1C1C`). One step above Ink.
- **Foreground:** Blossom. The reasoning text itself is pink — this is the one place Blossom is used as body text, not just accent.
- **Border:** Blossom. The left bar is pink, matching the text.
- **Toggle:** `+`/`-` marker in BOLD Blossom, followed by "Thought" label and optional duration in DIM Ash.
- **States:** Collapsed by default. Expanded reveals the full reasoning markdown.

### Popup / Overlay

Modal dialogs for pickers, theme selection, and configuration.

- **Shape:** Centered panel, no border. Semi-transparent backdrop (`rgba(0,0,0,150)`) covers the full screen.
- **Sizes:** Medium (60 cols), Large (88 cols), XLarge (116 cols). Clamped to terminal width minus 2.
- **Background:** Panel (`#141414`).
- **Header:** BOLD Blossom title, DIM Ash "esc" hint on the right.
- **Focus indicator:** `›` in BOLD Blossom for the selected row. `*` in BOLD Success for the active item (e.g., current theme).
- **Footer hints:** Key + label pairs (`↑↓` preview, `Enter` apply, `Esc` cancel) in Ash/Blossom.

### Permission Prompt

High-stakes modal. Must demand attention without being aggressive.

- **Shape:** Left-border only, `heavy` style. Border color: Input Border (`#808080`).
- **Background:** Header Surface (`#181818`).
- **Width:** 60–90 cols, centered.
- **Title:** "Permission Required" in BOLD Blossom.
- **Body:** Subject text in White. Explanation details (optional, toggled with `Ctrl+E`) in Ash.
- **Footer hints:** `Y/Enter` allow, `N/Esc` deny, `Shift+Tab` change mode, `Ctrl+E` details — all in DIM Ash.

### Diff View

Inline code diff display within tool messages.

- **Shape:** Full-width box, margin-top 1. Height: `min(18, max(6, lineCount + 1))`.
- **Added lines:** Success Background (`#16351F`), Diff Added foreground (`#3FB950`).
- **Removed lines:** Error Background (`#3A1F1F`), Diff Removed foreground (`#F85149`).
- **Line numbers:** Diff Line Number (`#8B949E`), DIM.
- **No border.** The background color difference is the separator.

## 6. Do's and Don'ts

### Do:

- **Do** use Blossom (`#FFB6C1`) only for focus, prompts, active selection, reasoning, and the logo. Its rarity is its power.
- **Do** convey hierarchy through background tonal shifts (Ink → Panel → Header Surface) — never through shadows.
- **Do** use BOLD for emphasis and DIM for de-emphasis. These are the only two attribute tiers besides regular.
- **Do** pair every color with a text label, icon, or position cue. Never rely on color alone to convey meaning.
- **Do** use the `›` character as the universal focus/selection marker in pickers and the composer prompt.
- **Do** use the `▌` left-border character for reasoning blocks — it's the signature visual pattern.
- **Do** maintain the 3-step tonal ladder: Ink (`#131313`) → Panel (`#141414`) → Header Surface (`#181818`). Each step is 1–2 luminance values.
- **Do** color-code context usage by threshold: Ash ‹60%, Warning 60–85%, Error ›85%.
- **Do** keep the Ash floor (`#4D4E4E`) as the minimum readable text color. Anything dimmer is invisible.
- **Do** embrace the character grid — every element aligns to terminal cells.

### Don't:

- **Don't** introduce a second brand color. Blossom is the only accent. If you need another hue, use the semantic colors (Error, Success, Info) — they exist for state, not decoration.
- **Don't** use CSS box-shadow, text-shadow, or any shadow simulation. The terminal is flat; depth comes from tonal layering and backdrop dimming only.
- **Don't** create generic terminal drab — "dense walls of monochrome text, no visual hierarchy, no color signaling. Tools that are function-first to the point of hostility." Every surface needs at least one visual cue (border, color, or attribute) to guide the eye.
- **Don't** mimic web-app layouts — "pseudo-windows, fake shadows, rounded boxes, attempting to recreate a browser layout inside a character grid. The terminal is its own medium; embrace its constraints instead of fighting them."
- **Don't** over-design with SaaS-in-terminal patterns — "too many colors, gradient effects, bloated chrome that wastes terminal rows on decoration instead of content. Slick but wasteful."
- **Don't** use Blossom as a background fill. It is always foreground, border, or accent — never a surface.
- **Don't** introduce a second font family. Monospace is the only family; the terminal doesn't support alternatives.
- **Don't** use border-left greater than 1px as a colored stripe — the `▌` reasoning border is a custom character pattern, not a CSS border-left accent.
- **Don't** dim text below Ash (`#4D4E4E`). If it needs to be quieter than Ash, remove it.
- **Don't** add the same border style to two different importance levels. The border-weight ladder (rounded → heavy → single → custom) is semantic.

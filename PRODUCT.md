# Product

## Register

product

## Users

Developers who live in the terminal. They use Neovim, tmux, helix, lazygit, and fzf as daily drivers. They're technical, keyboard-first, and intolerant of friction — every extra keystroke or wasted screen row is a tax. Their context when using Gambit: mid-task in a codebase, switching between editing, reviewing, and asking an AI agent to do work. They want the agent to feel like a fast, competent pair programmer sitting next to them in the terminal, not a browser tab they alt-tab to.

## Product Purpose

Gambit CLI is a terminal-based AI agent development environment. It exists to keep the entire AI coding workflow — conversation, tool execution, file editing, delegation, planning, memory — inside the terminal where developers already work. Success looks like: a developer never needs to leave their terminal to interact with an AI agent, and the experience is faster and more pleasant than any web-based alternative. It runs on OpenTUI with the Vercel AI SDK and OpenRouter, supports MCP for extensibility, and ships Agent Skills with progressive disclosure.

## Brand Personality

Confident, opinionated, warm.

Gambit knows what it is and doesn't apologize for it. It has a signature pink accent (`#FFB6C1`) that gives a terminal tool a human, approachable edge without being decorative. The warmth is in the craft — thoughtful defaults, keyboard shortcuts that feel natural, feedback that's immediate and clear. It's opinionated about how an AI agent should work (permission-gated tools, typed memory, plan mode, progressive skill disclosure) and those opinions are visible in the UI. The tool should feel alive and considered, not utilitarian and cold.

## Anti-references

- **Generic terminal drab**: Dense walls of monochrome text, no visual hierarchy, no color signaling. Tools that are function-first to the point of hostility — where reading the output feels like work. Gambit should never feel like a chore to look at.
- **Web-app mimicry in the terminal**: Pseudo-windows, fake shadows, rounded boxes, attempting to recreate a browser layout inside a character grid. The terminal is its own medium; embrace its constraints instead of fighting them.
- **Over-designed SaaS-in-terminal**: Too many colors, gradient effects, bloated chrome that wastes terminal rows on decoration instead of content. Slick but wasteful.

## Design Principles

1. **Embrace the terminal medium.** Every design choice should feel native to a character grid — box-drawing borders, monospace alignment, color as signal. Never mimic web layouts, fake shadows, or invent affordances the terminal doesn't support. The constraint is the aesthetic.

2. **Warmth through signal, not decoration.** The pink accent exists to make the tool feel alive and approachable — on borders, highlights, and active states where it carries meaning. Never use color purely for decoration. Every colored element should answer "what state is this communicating?"

3. **Keyboard-first, always.** Every action should be achievable without leaving the home row. Visual hierarchy should guide the eye, but the keyboard is the primary interaction layer. Never add a visual element that implies mouse interaction the terminal doesn't have.

4. **Show state at a glance.** Status, mode, permissions, model, task state — all visible in the chrome without digging. The developer should know what's happening by glancing at the screen, not by querying the tool. Muted text is for de-emphasis, not for hiding information that matters.

5. **Practice what you preach.** Gambit is a coding agent — its own codebase and UI should exemplify the craft it advocates. Clean component boundaries, consistent visual vocabulary, no half-implemented states. The tool's design quality is itself a statement about the agent's standards.

## Accessibility & Inclusion

- WCAG AA contrast ratios for all text, including muted/status text and placeholder content.
- No relying on color alone to convey meaning — always pair color with a text label, icon, or position cue.
- Both light and dark themes must be fully usable; neither is a second-class citizen.
- Color choices should be distinguishable for users with common color vision deficiencies (deuteranopia, protanopia, tritanopia). The pink accent should have sufficient luminance contrast against backgrounds in all themes.

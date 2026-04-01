# Gambit CLI

> Interactive AI agent development environment built with Bun, TypeScript, and OpenTUI.

[![Bun](https://img.shields.io/badge/built%20with-bun-ffd0db.svg)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/type-safe-TypeScript-blue.svg)](https://www.typescriptlang.org/)

## ✨ Overview

Gambit CLI is a terminal-based UI for creating, managing, and interacting with AI agents. It provides a rich interactive experience using [OpenTUI](https://github.com/opentui/opentui) components, with support for persistent memory, background tasks, tool execution, and fine-grained permissions.

Whether you're prototyping agent workflows or building production-ready AI assistants, Gambit offers a seamless development and runtime environment.

## 🚀 Quick Start

### Install globally (recommended)

```bash
bun add -g gambit
gambit
```

### Or run from source

```bash
git clone https://github.com/yourusername/gambit-opentui.git
cd gambit-opentui
bun install
bun run src/gambit.tsx
```

For development with hot-reload:

```bash
bun run src/index.tsx
```

## 📖 Usage

Once launched, you'll be greeted by the interactive REPL. Common commands:

- `/help` – Show available commands
- `/agent <name>` – Create or switch to an agent
- `/task <description>` – Create a background task
- `/memory` – View and manage stored memories
- `/tools` – List available tools
- `/exit` – Quit the application

Type natural language to interact with the current agent. Use arrow keys to navigate history, and `Ctrl+C` to interrupt long-running operations.

## 🛠️ Development

### Prerequisites

- **Bun** v1.2.20+ – [Installation guide](https://bun.sh/docs/installation)
- **TypeScript** (peer dependency)

### Commands

| Command | Description |
|---------|-------------|
| `bun install` | Install dependencies |
| `bun run src/gambit.tsx` | Run the standalone CLI |
| `bun run src/index.tsx` | Start dev UI with hot-reload |
| `bun test` | Run the test suite |
| `bun run tsc --noEmit` | Type-check the codebase |

### Project Structure

```
src/
├── agents/      # Agent definitions and runtime logic
├── app/         # Bootstrap and shell initialization
├── conversation/ # Conversation state machine and runner
├── lib/         # Shared utilities and helpers
├── memory/      # Memory persistence layer
├── permissions/ # Permission system and request handling
├── repl/        # Interactive REPL interface
├── session/     # Session management
├── tasks/       # Background task execution
├── tools/       # Tool implementations and tests
├── types/       # TypeScript type definitions
├── ui/          # @opentui/react components
├── workboard/   # Workboard UI
├── index.tsx    # Dev UI entry point (hot-reload)
└── gambit.tsx   # CLI binary entry point
```

## 🧪 Testing

Tests are colocated as `.test.ts` files next to the source they cover. Run all tests with:

```bash
bun test
```

To run a specific test file:

```bash
bun test src/tasks/task-runtime.test.ts
```

## 🤝 Contributing

We follow Conventional Commits and require passing tests and type-check for all PRs. See [AGENTS.md](AGENTS.md) for detailed contributor guidelines, coding style, and review process.

## 🔐 Security Notes

- Never commit secrets. Use a `.env` file (gitignored) for environment variables.
- Tools and agents must declare the minimal permissions they require.
- User data and network calls should be handled with care; add tests when changing permission logic.
- Runtime data (conversations, tasks, memories) lives in `.gambit/` and is **not** committed.
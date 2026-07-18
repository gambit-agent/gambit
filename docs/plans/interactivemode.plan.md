# Interactive mode

> Complete reference for keyboard shortcuts, input modes, and interactive features in gambit Code sessions.

## Keyboard shortcuts

### General controls

| Shortcut         | Description                                                              | Context                                                     |
| :--------------- | :----------------------------------------------------------------------- | :---------------------------------------------------------- |
| `Ctrl+C`         | Cancel current input or generation                                       | Standard interrupt                                          |
| `Ctrl+D`         | Exit gambit Code session                                                 | EOF signal                                                  |
| `Ctrl+L`         | Clear terminal screen                                                    | Keeps conversation history                                  |
| `Ctrl+R`         | Reverse search command history                                           | Search through previous commands interactively              |
| `Up/Down arrows` | Navigate command history                                                 | Recall previous inputs                                      |
| `Esc` + `Esc`    | Rewind the code/conversation                                             | Restore the code and/or conversation to a previous point    |
| `Tab`            | Toggle [extended thinking](/en/docs/build-with-gambit/extended-thinking) | Switch between Thinking on and Thinking off                 |
| `Shift+Tab`      | Toggle permission modes                                                  | Switch between Auto-accept Mode, Plan Mode, and Normal mode |

### Multiline input

| Method           | Shortcut       | Context                           |
| :--------------- | :------------- | :-------------------------------- |
| Quick escape     | `\` + `Enter`  | Works in all terminals            |
| macOS default    | `Option+Enter` | Default on macOS                  |
| Terminal setup   | `Shift+Enter`  | After `/terminal-setup`           |
| Control sequence | `Ctrl+J`       | Line feed character for multiline |
| Paste mode       | Paste directly | For code blocks, logs             |

<Tip>
  Configure your preferred line break behavior in terminal settings. Run `/terminal-setup` to install Shift+Enter binding for iTerm2 and VS Code terminals.
</Tip>

### Quick commands

| Shortcut     | Description                        | Notes                                                         |
| :----------- | :--------------------------------- | :------------------------------------------------------------ |
| `#` at start | Memory shortcut - add to gambit.md | Prompts for file selection                                    |
| `/` at start | Slash command                      | See [slash commands](/en/docs/gambit-code/slash-commands)     |
| `!` at start | Bash mode                          | Run commands directly and add execution output to the session |

## Vim editor mode

Enable vim-style editing with `/vim` command or configure permanently via `/config`.

### Mode switching

| Command | Action                      | From mode |
| :------ | :-------------------------- | :-------- |
| `Esc`   | Enter NORMAL mode           | INSERT    |
| `i`     | Insert before cursor        | NORMAL    |
| `I`     | Insert at beginning of line | NORMAL    |
| `a`     | Insert after cursor         | NORMAL    |
| `A`     | Insert at end of line       | NORMAL    |
| `o`     | Open line below             | NORMAL    |
| `O`     | Open line above             | NORMAL    |

### Navigation (NORMAL mode)

| Command         | Action                    |
| :-------------- | :------------------------ |
| `h`/`j`/`k`/`l` | Move left/down/up/right   |
| `w`             | Next word                 |
| `e`             | End of word               |
| `b`             | Previous word             |
| `0`             | Beginning of line         |
| `$`             | End of line               |
| `^`             | First non-blank character |
| `gg`            | Beginning of input        |
| `G`             | End of input              |

### Editing (NORMAL mode)

| Command        | Action                  |
| :------------- | :---------------------- |
| `x`            | Delete character        |
| `dd`           | Delete line             |
| `D`            | Delete to end of line   |
| `dw`/`de`/`db` | Delete word/to end/back |
| `cc`           | Change line             |
| `C`            | Change to end of line   |
| `cw`/`ce`/`cb` | Change word/to end/back |
| `.`            | Repeat last change      |

## Command history

gambit Code maintains command history for the current session:

* History is stored per working directory
* Cleared with `/clear` command
* Use Up/Down arrows to navigate (see keyboard shortcuts above)
* **Note**: History expansion (`!`) is disabled by default

### Reverse search with Ctrl+R

Press `Ctrl+R` to interactively search through your command history:

1. **Start search**: Press `Ctrl+R` to activate reverse history search
2. **Type query**: Enter text to search for in previous commands - the search term will be highlighted in matching results
3. **Navigate matches**: Press `Ctrl+R` again to cycle through older matches
4. **Accept match**:
   * Press `Tab` or `Esc` to accept the current match and continue editing
   * Press `Enter` to accept and execute the command immediately
5. **Cancel search**:
   * Press `Ctrl+C` to cancel and restore your original input
   * Press `Backspace` on empty search to cancel

The search displays matching commands with the search term highlighted, making it easy to find and reuse previous inputs.

## Background bash commands

gambit Code supports running bash commands in the background, allowing you to continue working while long-running processes execute.

### How backgrounding works

When gambit Code runs a command in the background, it runs the command asynchronously and immediately returns a background task ID. gambit Code can respond to new prompts while the command continues executing in the background.

To run commands in the background, you can either:

* Prompt gambit Code to run a command in the background
* Press Ctrl+B to move a regular Bash tool invocation to the background. (Tmux users must press Ctrl+B twice due to tmux's prefix key.)

**Key features:**

* Output is buffered and gambit can retrieve it using the BashOutput tool
* Background tasks have unique IDs for tracking and output retrieval
* Background tasks are automatically cleaned up when gambit Code exits

**Common backgrounded commands:**

* Build tools (webpack, vite, make)
* Package managers (npm, yarn, pnpm)
* Test runners (jest, pytest)
* Development servers
* Long-running processes (docker, terraform)

### Bash mode with `!` prefix

Run bash commands directly without going through gambit by prefixing your input with `!`:

```bash
! npm test
! git status
! ls -la
```

Bash mode:

* Adds the command and its output to the conversation context
* Shows real-time progress and output
* Supports the same `Ctrl+B` backgrounding for long-running commands
* Does not require gambit to interpret or approve the command

This is useful for quick shell operations while maintaining conversation context.

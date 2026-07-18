# Custom slash commands
Custom slash commands allow you to define frequently-used prompts as Markdown files that Gambit can execute. Commands are organized by scope (project-specific or personal) and support namespacing through directory structures.

Syntax

/<command-name> [arguments]

Parameters
Parameter	Description
<command-name>	Name derived from the Markdown filename (without .md extension)
[arguments]	Optional arguments passed to the command

Command types

Built-in commands
Use built-in slash commands for quick workspace actions.

- /clear — Clear conversation history.

Project commands
Commands stored in your repository and shared with your team. When listed in /help, these commands show "(project)" after their description.
Location: .gambit/commands/
In the following example, we create the /optimize command:

# Create a project command
mkdir -p .gambit/commands
echo "Analyze this code for performance issues and suggest optimizations:" > .gambit/commands/optimize.md

Personal commands
Commands available across all your projects. When listed in /help, these commands show "(user)" after their description.
Location: ~/.gambit/commands/
In the following example, we create the /security-review command:

# Create a personal command
mkdir -p ~/.gambit/commands
echo "Review this code for security vulnerabilities:" > ~/.gambit/commands/security-review.md

Features

Namespacing
Organize commands in subdirectories. The subdirectories are used for organization and appear in the command description, but they do not affect the command name itself. The description will show whether the command comes from the project directory (.gambit/commands) or the user-level directory (~/.gambit/commands), along with the subdirectory name.
Conflicts between user and project level commands are not supported. Otherwise, multiple commands with the same base file name can coexist.
For example, a file at .gambit/commands/frontend/component.md creates the command /component with description showing "(project:frontend)". Meanwhile, a file at ~/.gambit/commands/component.md creates the command /component with description showing "(user)".

Arguments
Pass dynamic values to commands using argument placeholders:
All arguments with $ARGUMENTS
The $ARGUMENTS placeholder captures all arguments passed to the command:

# Command definition
echo 'Fix issue #$ARGUMENTS following our coding standards' > .gambit/commands/fix-issue.md

# Usage
> /fix-issue 123 high-priority
# $ARGUMENTS becomes: "123 high-priority"
Individual arguments with $1, $2, etc.
Access specific arguments individually using positional parameters (similar to shell scripts):

# Command definition  
echo 'Review PR #$1 with priority $2 and assign to $3' > .gambit/commands/review-pr.md

# Usage
> /review-pr 456 high alice
# $1 becomes "456", $2 becomes "high", $3 becomes "alice"
Use positional arguments when you need to:
Access arguments individually in different parts of your command
Provide defaults for missing arguments
Build more structured commands with specific parameter roles

Bash command execution
Execute bash commands before the slash command runs using the ! prefix. The output is included in the command context. You must include allowed-tools with the Bash tool, but you can choose the specific bash commands to allow.
For example:

---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*)
description: Create a git commit
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Recent commits: !`git log --oneline -10`

## Your task

Based on the above changes, create a single git commit.

File references
Include file contents in commands using the @ prefix to reference files.
For example:

# Reference a specific file

Review the implementation in @src/utils/helpers.js

# Reference multiple files

Compare @src/old-version.js with @src/new-version.js

Thinking mode
Slash commands can trigger extended thinking by including extended thinking keywords.

Frontmatter
Command files support frontmatter, useful for specifying metadata about the command:
Frontmatter	Purpose	Default
allowed-tools	List of tools the command can use	Inherits from the conversation
argument-hint	The arguments expected for the slash command. Example: argument-hint: add [tagId] | remove [tagId] | list. This hint is shown to the user when auto-completing the slash command.	None
description	Brief description of the command	Uses the first line from the prompt
model	Specific model string (see Models overview)	Inherits from the conversation
disable-model-invocation	Whether to prevent SlashCommand tool from calling this command	false
For example:

---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*)
argument-hint: [message]
description: Create a git commit
model: gambit-3-5-haiku-20241022
---

Create a git commit with message: $ARGUMENTS
Example using positional arguments:

---
argument-hint: [pr-number] [priority] [assignee]
description: Review pull request
---

Review PR #$1 with priority $2 and assign to $3.
Focus on security, performance, and code style.


SlashCommand tool
The SlashCommand tool allows gambit to execute custom slash commands programmatically during a conversation. This gives gambit the ability to invoke custom commands on your behalf when appropriate.
To encourage gambit to trigger SlashCommand tool, your instructions (prompts, gambit.md, etc.) generally need to reference the command by name with its slash.
Example:

Copy
> Run /write-unit-test when you are about to start writing tests.
This tool puts each available custom slash command's metadata into context up to the character budget limit. You can use /context to monitor token usage and follow the operations below to manage context.

SlashCommand tool supported commands
SlashCommand tool only supports custom slash commands that:
Are user-defined. Built-in commands like /compact and /init are not supported.
Have the description frontmatter field populated. We use the description in the context.
For gambit Code versions >= 1.0.124, you can see which custom slash commands SlashCommand tool can invoke by running gambit --debug and triggering a query.

Disable SlashCommand tool
To prevent gambit from executing any slash commands via the tool:

Copy
/permissions
# Add to deny rules: SlashCommand
This will also remove SlashCommand tool (and the slash command descriptions) from context.

Disable specific commands only
To prevent a specific slash command from becoming available, add disable-model-invocation: true to the slash command's frontmatter.
This will also remove the command's metadata from context.

SlashCommand permission rules
The permission rules support:
Exact match: SlashCommand:/commit (allows only /commit with no arguments)
Prefix match: SlashCommand:/review-pr:* (allows /review-pr with any arguments)

Character budget limit
The SlashCommand tool includes a character budget to limit the size of command descriptions shown to gambit. This prevents token overflow when many commands are available.
The budget includes each custom slash command's name, args, and description.
Default limit: 15,000 characters
Custom limit: Set via SLASH_COMMAND_TOOL_CHAR_BUDGET environment variable
When the character budget is exceeded, gambit will see only a subset of the available commands. In /context, a warning will show with "M of N commands".
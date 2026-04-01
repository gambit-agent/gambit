# Gambit

A React-based application built with Bun and TypeScript.
<img width="1727" height="1360" alt="Screenshot 2026-04-01 072936" src="https://github.com/user-attachments/assets/5cee8036-a135-4680-a59e-d73cd9ce20bb" />

## Quick Start


### Option 1: Use the setup scripts

**For Bash/Zsh:**
Setting up Gambit CLI command...
gambit alias already exists in ~/.bashrc
Added gambit alias to ~/.zshrc
Setup complete! Please run 'source ~/.bashrc' or restart your terminal to use the 'gambit' command.
You can now run 'gambit' from anywhere to start the application.

**For PowerShell:**


**For CMD:**


### Option 2: Manual setup

After running the setup, you can simply type:


Instead of:


## Development

### Prerequisites
- Bun v1.2.20+
- Node.js (for TypeScript)

### Installation


### Running the application


### Building


### Testing


## Project Structure

- **src/**: Main source code directory
  - **lib/**: Utility libraries and core functionality
  - **types/**: TypeScript type definitions
  - **ui/**: React components and theming
  - **tools/**: Tool implementations and tests
- **src/gambit.tsx**: Executable entry point for CLI usage
- **src/index.tsx**: Default entry point

## Setup Details

The project now includes:
- : Executable script with shebang for direct execution
- : Updated with  field for CLI installation
- : Bash/Zsh setup script
- : PowerShell setup script  
- : CMD setup script
- : Detailed installation instructions

These changes allow you to run the application with just  instead of  from any directory.

#!/bin/bash

# Setup script for Gambit CLI command
echo "Setting up Gambit CLI command..."

# Get the current directory
CURRENT_DIR=/mnt/c/Users/sergi/DEV/gambit/gambit-opentui

# Add alias to bashrc
if [ -f ~/.bashrc ]; then
    if ! grep -q "alias gambit=" ~/.bashrc; then
        echo "alias gambit='cd  && bun run .'" >> ~/.bashrc
        echo "Added gambit alias to ~/.bashrc"
    else
        echo "gambit alias already exists in ~/.bashrc"
    fi
fi

# Add alias to zshrc
if [ -f ~/.zshrc ]; then
    if ! grep -q "alias gambit=" ~/.zshrc; then
        echo "alias gambit='cd  && bun run .'" >> ~/.zshrc
        echo "Added gambit alias to ~/.zshrc"
    else
        echo "gambit alias already exists in ~/.zshrc"
    fi
fi

echo "Setup complete! Please run 'source ~/.bashrc' or restart your terminal to use the 'gambit' command."
echo "You can now run 'gambit' from anywhere to start the application."

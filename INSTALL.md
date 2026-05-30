# Install Gambit

Gambit publishes self-contained binaries for Linux and macOS on GitHub Releases. The recommended install is the extensionless Bash installer:

```bash
curl -fsSL https://raw.githubusercontent.com/sergiomasellis/gambit-cli/main/install | bash
```

The installer downloads the matching binary for your platform, verifies it against the release `manifest.json`, installs it to `~/.local/bin/gambit`, and adds that directory to your shell PATH when possible.

## Options

```bash
# Latest stable release
curl -fsSL https://raw.githubusercontent.com/sergiomasellis/gambit-cli/main/install | bash

# Specific release
curl -fsSL https://raw.githubusercontent.com/sergiomasellis/gambit-cli/main/install | bash -s -- --version 0.6.0

# Local compiled binary
./install --binary ./gambit

# Custom install directory
GAMBIT_BIN_DIR="$HOME/bin" ./install

# Do not edit shell startup files
./install --no-modify-path
```

Supported release targets:

- `linux-x64`
- `linux-x64-musl`
- `linux-arm64`
- `linux-arm64-musl`
- `darwin-x64`
- `darwin-arm64`

## Install From Source

Source installs require [Bun](https://bun.sh) 1.2.20 or newer.

```bash
git clone https://github.com/sergiomasellis/gambit-cli.git
cd gambit-cli
bun install
make build
make install
```

For active development, link the checkout instead of copying a compiled binary:

```bash
bun install
make link-local
```

## Windows

Native Windows release binaries are not published yet. Use WSL with the Bash installer, or run from source with Bun:

```powershell
bun install
bun run src/gambit.tsx
```

From a Windows source checkout, `setup.ps1` and `setup.bat` compile `gambit.exe` and copy it to `%USERPROFILE%\.local\bin` unless `GAMBIT_BIN_DIR` is set.

## Verify

```bash
gambit --version
gambit --help
```

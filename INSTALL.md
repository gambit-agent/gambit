# Install Gambit

Gambit publishes self-contained binaries for Windows, Linux, and macOS on GitHub Releases.

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/gambit-agent/gambit/main/install.ps1 | iex
```

Linux, macOS, and WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/gambit-agent/gambit/main/install | bash
```

The installer downloads the matching binary for your platform, verifies it against the release `manifest.json`, installs it to the user-local bin directory, and adds that directory to PATH when possible.

## Options

```bash
# Bash: latest stable release
curl -fsSL https://raw.githubusercontent.com/gambit-agent/gambit/main/install | bash

# Bash: specific release
curl -fsSL https://raw.githubusercontent.com/gambit-agent/gambit/main/install | bash -s -- --version 0.15.0

# Bash: local compiled binary
./install --binary ./gambit

# Bash: custom install directory
GAMBIT_BIN_DIR="$HOME/bin" ./install

# Bash: do not edit shell startup files
./install --no-modify-path
```

```powershell
# PowerShell: specific release
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/gambit-agent/gambit/main/install.ps1))) -Version 0.15.0

# PowerShell: local compiled binary
.\install.ps1 -Binary .\gambit.exe

# PowerShell: custom install directory
$env:GAMBIT_BIN_DIR = "$HOME\bin"; .\install.ps1

# PowerShell: do not update the user PATH
.\install.ps1 -NoModifyPath
```

## Update

Once Gambit is installed, update to the latest release with:

```bash
gambit update
```

To install a specific release, run:

```bash
gambit update 0.15.0
```

On Windows, `gambit update` downloads `install.ps1`, waits for the running `gambit.exe` to exit, then replaces it. On WSL, it uses the Bash installer and installs the Linux binary inside WSL.

Supported release targets:

- `linux-x64`
- `linux-x64-musl`
- `linux-arm64`
- `linux-arm64-musl`
- `darwin-x64`
- `darwin-arm64`
- `windows-x64`

## Install From Source

Source installs require [Bun](https://bun.sh) 1.2.20 or newer.

```bash
git clone https://github.com/gambit-agent/gambit.git
cd gambit
bun install
make build
make install
```

For active development, link the checkout instead of copying a compiled binary:

```bash
bun install
make link-local
```

## Windows Source Installs

Native Windows release binaries are installed with `install.ps1`. To run from source with Bun instead:

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

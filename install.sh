#!/bin/bash

set -e

# Parse command line arguments
TARGET="$1"  # Optional target parameter

# Validate target if provided
if [[ -n "$TARGET" ]] && [[ ! "$TARGET" =~ ^(stable|latest|[0-9]+\.[0-9]+\.[0-9]+(-[^[:space:]]+)?)$ ]]; then
    echo "Usage: $0 [stable|latest|VERSION]" >&2
    exit 1
fi

REPO="${GAMBIT_REPO:-sergiomasellis/gambit-cli}"
API_BASE="https://api.github.com/repos/$REPO"
RELEASE_BASE="https://github.com/$REPO/releases/download"
DOWNLOAD_DIR="$HOME/.gambit/downloads"

# Check for required dependencies
DOWNLOADER=""
if command -v curl >/dev/null 2>&1; then
    DOWNLOADER="curl"
elif command -v wget >/dev/null 2>&1; then
    DOWNLOADER="wget"
else
    echo "Either curl or wget is required but neither is installed" >&2
    exit 1
fi

# Check if jq is available (optional)
HAS_JQ=false
if command -v jq >/dev/null 2>&1; then
    HAS_JQ=true
fi

# Download function that works with both curl and wget
download_file() {
    local url="$1"
    local output="$2"

    if [ "$DOWNLOADER" = "curl" ]; then
        if [ -n "$output" ]; then
            curl -fsSL -o "$output" "$url"
        else
            curl -fsSL "$url"
        fi
    elif [ "$DOWNLOADER" = "wget" ]; then
        if [ -n "$output" ]; then
            wget -q -O "$output" "$url"
        else
            wget -q -O - "$url"
        fi
    else
        return 1
    fi
}

# Simple JSON parser for extracting the checksum when jq is not available
get_checksum_from_manifest() {
    local json="$1"
    local platform="$2"

    json=$(echo "$json" | tr -d '\n\r\t' | sed 's/ \+/ /g')

    if [[ $json =~ \"$platform\"[^}]*\"checksum\"[[:space:]]*:[[:space:]]*\"([a-f0-9]{64})\" ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi

    return 1
}

# Simple JSON parser for extracting a top-level string field
get_string_field() {
    local json="$1"
    local field="$2"

    json=$(echo "$json" | tr -d '\n\r\t' | sed 's/ \+/ /g')
    if [[ $json =~ \"$field\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi
    return 1
}

# Detect platform
case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    MINGW*|MSYS*|CYGWIN*)
        echo "Windows is not supported by this script. Install via WSL or use setup.ps1 for a source-based install." >&2
        exit 1
        ;;
    *)
        echo "Unsupported operating system: $(uname -s)." >&2
        exit 1
        ;;
esac

case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *)
        echo "Unsupported architecture: $(uname -m)" >&2
        exit 1
        ;;
esac

# Detect Rosetta 2 on macOS: prefer native arm64 build
if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
    if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = "1" ]; then
        arch="arm64"
    fi
fi

# Detect musl on Linux and adjust platform accordingly
if [ "$os" = "linux" ]; then
    if [ -f /lib/libc.musl-x86_64.so.1 ] || [ -f /lib/libc.musl-aarch64.so.1 ] || ldd /bin/ls 2>&1 | grep -q musl; then
        platform="linux-${arch}-musl"
    else
        platform="linux-${arch}"
    fi
else
    platform="${os}-${arch}"
fi

mkdir -p "$DOWNLOAD_DIR"

# Resolve target version using the GitHub Releases API
resolve_version() {
    local target="${1:-stable}"
    case "$target" in
        ""|stable|latest)
            local release_json
            release_json=$(download_file "$API_BASE/releases/latest") || return 1
            local tag
            if [ "$HAS_JQ" = true ]; then
                tag=$(echo "$release_json" | jq -r '.tag_name // empty')
            else
                tag=$(get_string_field "$release_json" "tag_name") || return 1
            fi
            echo "${tag#v}"
            ;;
        *)
            echo "$target"
            ;;
    esac
}

version=$(resolve_version "$TARGET")
if [ -z "$version" ]; then
    echo "Unable to resolve a release version for '$TARGET'." >&2
    echo "Check that https://github.com/$REPO/releases has a published release." >&2
    exit 1
fi

tag="v$version"

# Download manifest and extract checksum
manifest_json=$(download_file "$RELEASE_BASE/$tag/manifest.json") || {
    echo "Failed to download manifest from $RELEASE_BASE/$tag/manifest.json" >&2
    exit 1
}

if [ "$HAS_JQ" = true ]; then
    checksum=$(echo "$manifest_json" | jq -r ".platforms[\"$platform\"].checksum // empty")
else
    checksum=$(get_checksum_from_manifest "$manifest_json" "$platform")
fi

# Validate checksum format (SHA256 = 64 hex characters)
if [ -z "$checksum" ] || [[ ! "$checksum" =~ ^[a-f0-9]{64}$ ]]; then
    echo "Platform $platform not found in manifest for $tag" >&2
    exit 1
fi

# Download the binary and verify
binary_name="gambit-$platform"
binary_path="$DOWNLOAD_DIR/gambit-$version-$platform"
if ! download_file "$RELEASE_BASE/$tag/$binary_name" "$binary_path"; then
    echo "Download failed: $RELEASE_BASE/$tag/$binary_name" >&2
    rm -f "$binary_path"
    exit 1
fi

# Pick the right checksum tool
if [ "$os" = "darwin" ]; then
    actual=$(shasum -a 256 "$binary_path" | cut -d' ' -f1)
else
    actual=$(sha256sum "$binary_path" | cut -d' ' -f1)
fi

if [ "$actual" != "$checksum" ]; then
    echo "Checksum verification failed for $binary_path" >&2
    echo "  expected: $checksum" >&2
    echo "  actual:   $actual" >&2
    rm -f "$binary_path"
    exit 1
fi

chmod +x "$binary_path"

# Run gambit install to set up launcher and shell integration
echo "Setting up Gambit..."
"$binary_path" install ${TARGET:+"$TARGET"}

# Clean up downloaded file
rm -f "$binary_path"

echo ""
echo "Installation complete!"

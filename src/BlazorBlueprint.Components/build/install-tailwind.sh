#!/bin/bash
# Tailwind CLI Downloader for Linux/macOS (Multi-Arch)

set -euo pipefail

TAILWIND_VERSION="${TAILWIND_VERSION:-v4.2.2}"
SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

ARCH=$(uname -m)
OS=$(uname -s)

if [ "$OS" == "Linux" ]; then
    TARGET="tailwindcss-linux"
    if [ "$ARCH" == "x86_64" ]; then
        PLATFORM="linux-x64"
    elif [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
        PLATFORM="linux-arm64"
    else
        echo "Unsupported Linux Architecture: $ARCH"
        exit 1
    fi
elif [ "$OS" == "Darwin" ]; then
    TARGET="tailwindcss-macos"
    if [ "$ARCH" == "arm64" ]; then
        PLATFORM="macos-arm64"
    else
        PLATFORM="macos-x64"
    fi
else
    echo "Unsupported OS: $OS"
    exit 1
fi

URL="https://github.com/tailwindlabs/tailwindcss/releases/download/$TAILWIND_VERSION/tailwindcss-$PLATFORM"

echo "Downloading $URL..."
curl -L "$URL" -o "$SCRIPT_DIRECTORY/$TARGET"
chmod +x "$SCRIPT_DIRECTORY/$TARGET"
echo "Done! Binary saved as $SCRIPT_DIRECTORY/$TARGET"

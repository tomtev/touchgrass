#!/bin/bash
set -euo pipefail

REPO="tomtev/touchgrass"
INSTALL_DIR="${TG_INSTALL_DIR:-$HOME/.local/bin}"
BINARY_NAME="tg"
WINDOWS_OS=false

# Colors
DIM='\033[2m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

info() { echo -e "  ${DIM}$1${NC}"; }
success() { echo -e "  ${GREEN}$1${NC}"; }
warn() { echo -e "  ${DIM}⚠ $1${NC}"; }
error() { echo -e "  ❌ ${BOLD}$1${NC}" >&2; exit 1; }

EXISTING_INSTALL=false
if [ -x "${INSTALL_DIR}/${BINARY_NAME}" ] || command -v tg &>/dev/null || command -v tg.exe &>/dev/null; then
  EXISTING_INSTALL=true
fi

echo ""
echo -e "  ${BOLD}⛳️ touchgrass.sh${NC}"
echo -e "  ${DIM}Manage Claude Code, Codex, and more from your phone.${NC}"
echo ""

# Detect OS
OS="$(uname -s)"
case "$OS" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  CYGWIN*|MINGW*|MSYS*)
    OS="windows"
    WINDOWS_OS=true
    BINARY_NAME="tg.exe"
    INSTALL_DIR="${TG_INSTALL_DIR:-$HOME/.touchgrass/bin}"
    ;;
  *)      error "Unsupported OS: $OS" ;;
esac

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)  ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)             error "Unsupported architecture: $ARCH" ;;
esac

if [ "$WINDOWS_OS" = true ]; then
  if [ "$ARCH" != "x64" ]; then
    error "Unsupported Windows architecture: $ARCH (supported: x64)"
  fi
  TARGET="${OS}-${ARCH}.exe"
else
  TARGET="${OS}-${ARCH}"
fi
info "Platform: ${TARGET}"

# Get latest release tag
info "Fetching latest release..."
LATEST=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
if [ -z "$LATEST" ]; then
  error "Could not determine latest release. Check https://github.com/${REPO}/releases"
fi
info "Version: ${LATEST}"

# Download binary
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST}/tg-${TARGET}"
info "Downloading..."

TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

HTTP_CODE=$(curl -fsSL -w "%{http_code}" -o "$TMPFILE" "$DOWNLOAD_URL" 2>/dev/null || true)
if [ "$HTTP_CODE" != "200" ] || [ ! -s "$TMPFILE" ]; then
  error "Failed to download binary for ${TARGET}."
fi

# Install
mkdir -p "$INSTALL_DIR"
mv "$TMPFILE" "${INSTALL_DIR}/${BINARY_NAME}"
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

# Probe daemon compatibility with the new binary without forcing a restart.
if [ -f "$HOME/.touchgrass/daemon.pid" ]; then
  BEFORE_PID="$(cat "$HOME/.touchgrass/daemon.pid" 2>/dev/null || true)"
  if "${INSTALL_DIR}/${BINARY_NAME}" ls &>/dev/null; then
    AFTER_PID="$(cat "$HOME/.touchgrass/daemon.pid" 2>/dev/null || true)"
    if [ -n "${AFTER_PID}" ] && kill -0 "${AFTER_PID}" 2>/dev/null; then
      if [ -n "${BEFORE_PID}" ] && [ "${BEFORE_PID}" = "${AFTER_PID}" ]; then
        info "Daemon kept alive (${AFTER_PID})"
      else
        info "Daemon refreshed (${AFTER_PID})"
      fi
    else
      warn "Daemon check completed but PID could not be verified."
    fi
  else
    warn "Daemon compatibility check failed; existing sessions may need manual reconnect."
  fi
fi

echo ""
if [ "$EXISTING_INSTALL" = true ]; then
  success "✅ touchgrass.sh updated to ${LATEST}"
else
  success "✅ Installed tg to ${INSTALL_DIR}/${BINARY_NAME}"

  # Check if INSTALL_DIR is in PATH
  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
    echo ""
    if [ "$WINDOWS_OS" = true ]; then
      info "Add this to your shell profile (Git Bash):"
      echo ""
      echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
      echo ""
      info "For PowerShell users, run:"
      echo ""
      echo "    irm https://raw.githubusercontent.com/${REPO}/main/install.ps1 | iex"
    else
      info "Add this to your shell profile:"
      echo ""
      echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
    fi
  fi

  echo ""
  success "Run 'tg init' to get started."
fi
echo ""

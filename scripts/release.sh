#!/bin/bash
set -euo pipefail

# Build release binaries and create a GitHub release
# Usage: ./scripts/release.sh [version]
# Example: ./scripts/release.sh v0.1.0

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  # Read from package.json
  VERSION="v$(grep '"version"' package.json | sed -E 's/.*"([^"]+)".*/\1/')"
fi

echo "Building release ${VERSION}..."

DIST_DIR="dist"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# Build for each target
TARGETS=(
  "bun-darwin-arm64:tg-darwin-arm64"
  "bun-darwin-x64:tg-darwin-x64"
  "bun-linux-arm64:tg-linux-arm64"
  "bun-linux-x64:tg-linux-x64"
)

for entry in "${TARGETS[@]}"; do
  TARGET="${entry%%:*}"
  OUTPUT="${entry##*:}"
  echo "  Building ${OUTPUT} (${TARGET})..."
  bun build src/main.ts --compile --target="$TARGET" --outfile "${DIST_DIR}/${OUTPUT}" 2>&1 | tail -1
done

echo ""
echo "Binaries built in ${DIST_DIR}/:"
ls -lh "$DIST_DIR"/

echo ""
read -p "Create GitHub release ${VERSION}? [y/N] " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  # Check gh is available
  if ! command -v gh &>/dev/null; then
    echo "Error: gh CLI not installed. Install from https://cli.github.com"
    exit 1
  fi

  echo "Creating release ${VERSION}..."
  gh release create "$VERSION" \
    --title "$VERSION" \
    --generate-notes \
    "${DIST_DIR}"/tg-*

  echo ""
  echo "Release created: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/tag/${VERSION}"
  echo ""
  echo "Users can install with:"
  echo "  curl -fsSL https://touchgrass.sh/install.sh | bash"
fi

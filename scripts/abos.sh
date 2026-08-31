#!/bin/sh
# ABOS Installer
# Run this installer from an authenticated ABOS checkout.
set -e

REPO="https://github.com/hopetmpy/ABOS.git"

# Determine install directory.
# Runtime source must not live inside ~/.abos, which is reserved for identity
# and state. ABOS_RUNTIME_DIR is the canonical override. ABOS_DIR remains a
# deprecated installer-only alias for compatibility with early rebrand builds.
if [ -n "$ABOS_RUNTIME_DIR" ]; then
  INSTALL_DIR="$ABOS_RUNTIME_DIR"
elif [ -n "$ABOS_DIR" ]; then
  echo "[WARN]  ABOS_DIR as a runtime path is deprecated; use ABOS_RUNTIME_DIR." >&2
  INSTALL_DIR="$ABOS_DIR"
elif [ -w /opt ] || [ "$(id -u)" = "0" ]; then
  INSTALL_DIR="/opt/abos"
else
  DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
  INSTALL_DIR="$DATA_HOME/abos/runtime"
fi

# Early ABOS installers used ~/.abos/runtime, mixing executable source with
# identity/state. Move only a real Git checkout out of the state directory.
LEGACY_ABOS_RUNTIME="$HOME/.abos/runtime"
if [ "$INSTALL_DIR" != "$LEGACY_ABOS_RUNTIME" ] &&
   [ ! -e "$INSTALL_DIR" ] &&
   [ -d "$LEGACY_ABOS_RUNTIME/.git" ]; then
  echo "[INFO]  Moving legacy ABOS runtime out of ~/.abos state..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  mv "$LEGACY_ABOS_RUNTIME" "$INSTALL_DIR"
fi

# Preflight: Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js is required (>= 20). Install it first." >&2
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[ERROR] Node.js >= 20 required, found $(node -v)." >&2
  exit 1
fi

# Preflight: git
if ! command -v git >/dev/null 2>&1; then
  echo "[ERROR] git is required." >&2
  exit 1
fi

# Enable pnpm via corepack
if ! command -v pnpm >/dev/null 2>&1; then
  echo "[INFO]  Enabling pnpm via corepack..."
  corepack enable pnpm || {
    echo "[ERROR] Failed to enable pnpm. Install it manually: npm i -g pnpm" >&2
    exit 1
  }
fi

# Clone or update
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "[INFO]  Updating existing installation at $INSTALL_DIR..."
  cd "$INSTALL_DIR"

  CURRENT_ORIGIN="$(git remote get-url origin 2>/dev/null || true)"
  NORMALIZED_ORIGIN="$(printf '%s' "$CURRENT_ORIGIN" | sed \
    -e 's#^git@github.com:#https://github.com/#' \
    -e 's#^https://[^/@]*@github.com/#https://github.com/#' \
    -e 's#\.git$##' \
    -e 's#/$##' | tr '[:upper:]' '[:lower:]')"

  case "$NORMALIZED_ORIGIN" in
    "https://github.com/hopetmpy/abos")
      # Already canonical. Preserve the existing HTTPS/SSH transport.
      ;;
    "https://github.com/hopetmpy/automatom")
      # Migrate only the known historical repository while preserving
      # the authentication transport/credentials already configured.
      MIGRATED_ORIGIN="$(printf '%s' "$CURRENT_ORIGIN" | sed -E 's#hopetmpy/automatom(\.git)?$#hopetmpy/ABOS.git#')"
      git remote set-url origin "$MIGRATED_ORIGIN"
      ;;
    *)
      echo "[ERROR] Refusing to update: $INSTALL_DIR is a Git repository whose origin is not the canonical ABOS repository." >&2
      echo "[ERROR] Origin: ${CURRENT_ORIGIN:-<missing>}" >&2
      exit 1
      ;;
  esac

  git fetch origin main
  git pull origin main --ff-only
else
  echo "[INFO]  Cloning ABOS to $INSTALL_DIR..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Install and build
echo "[INFO]  Installing dependencies..."
pnpm install --frozen-lockfile
echo "[INFO]  Building..."
pnpm run build

# Launch
exec node dist/index.js --run

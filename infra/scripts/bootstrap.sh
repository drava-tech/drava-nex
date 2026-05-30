#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────
#  cms-platform — Bootstrap Script
#  Installs dependencies and builds all packages in order.
# ────────────────────────────────────────────────────────────
set -e

echo ""
echo "┌──────────────────────────────────────────────────────┐"
echo "│       cms-platform  —  Bootstrap                     │"
echo "└──────────────────────────────────────────────────────┘"

echo "→ Installing dependencies via pnpm..."
pnpm install

echo "→ Building all packages (Turborepo)..."
pnpm run build

echo ""
echo "✅  Bootstrap complete. Start dev servers with:"
echo "      pnpm run dev"
echo ""

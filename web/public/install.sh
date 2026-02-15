#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required but not installed." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required but not installed." >&2
  exit 1
fi

echo "Installing openlap globally..."
npm install -g openlap

echo
echo "Install complete."
echo "Run: openlap --help"

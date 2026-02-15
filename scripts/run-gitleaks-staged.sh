#!/usr/bin/env sh
set -eu

if ! command -v gitleaks >/dev/null 2>&1; then
  printf '%s\n' 'gitleaks is required for pre-commit secret scanning.'
  printf '%s\n' 'Install with: brew install gitleaks'
  printf '%s\n' 'More options: https://github.com/gitleaks/gitleaks#installing'
  exit 1
fi

gitleaks git --staged --redact --config .gitleaks.toml

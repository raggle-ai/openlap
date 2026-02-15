#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Install openlap globally.

Usage:
  ./install.sh [--channel <release|stable|edge>] [--ref <tag>] [--repo <owner/repo>] [--fix-path] [--yes] [--help]

Options:
  --channel    Install source: release (default), stable (npm), or edge (GitHub main clone).
  --ref        Release tag when using --channel release (default: latest).
  --repo       GitHub repository for release/edge channels (default: raggle-ai/openlap).
  --fix-path   Automatically add npm global bin to your shell PATH.
  --yes        Non-interactive mode; implies yes to PATH update prompt.
  --help       Show this help text.

Examples:
  ./install.sh
  ./install.sh --channel release
  ./install.sh --channel release --ref v0.1.0
  ./install.sh --channel stable
  ./install.sh --channel edge
  ./install.sh --fix-path
  curl -fsSL https://openlap.dev/install.sh | bash -s -- --channel release --fix-path
EOF
}

log() {
  printf '%s\n' "$*"
}

warn() {
  printf 'Warning: %s\n' "$*" >&2
}

ensure_line_in_file() {
  local line="$1"
  local file="$2"

  touch "$file"
  if ! grep -Fq "$line" "$file"; then
    printf '\n%s\n' "$line" >>"$file"
  fi
}

ensure_cmd() {
  local command_name="$1"
  local message="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Error: %s\n' "$message" >&2
    exit 1
  fi
}

fix_path_for_zsh_or_bash() {
  local shell_name="$1"
  local npm_bin="$2"
  local line="export PATH=\"${npm_bin}:\$PATH\""
  local target_file

  if [ "$shell_name" = "zsh" ]; then
    target_file="${HOME}/.zshrc"
  else
    if [ -f "${HOME}/.bashrc" ]; then
      target_file="${HOME}/.bashrc"
    else
      target_file="${HOME}/.bash_profile"
    fi
  fi

  ensure_line_in_file "$line" "$target_file"
  log "Updated ${target_file}"
}

fix_path_for_fish() {
  local npm_bin="$1"
  local fish_dir="${HOME}/.config/fish/conf.d"
  local fish_file="${fish_dir}/openlap_path.fish"

  mkdir -p "$fish_dir"
  cat >"$fish_file" <<EOF
if test -d "${npm_bin}"
    if not contains "${npm_bin}" \$fish_user_paths
        set -Ux fish_user_paths "${npm_bin}" \$fish_user_paths
    end
end
EOF
  log "Updated ${fish_file}"
}

fix_path() {
  local shell_name="$1"
  local npm_bin="$2"

  case "$shell_name" in
    zsh|bash)
      fix_path_for_zsh_or_bash "$shell_name" "$npm_bin"
      ;;
    fish)
      fix_path_for_fish "$npm_bin"
      ;;
    *)
      warn "Could not auto-update PATH for shell '${shell_name}'."
      log "Add this line to your shell profile:"
      log "  export PATH=\"${npm_bin}:\$PATH\""
      return 1
      ;;
  esac

  return 0
}

prompt_yes_no() {
  local prompt="$1"
  local response
  printf "%s [y/N]: " "$prompt"
  read -r response
  case "$response" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

install_stable_from_npm() {
  log "Installing openlap globally from npm..."
  npm install -g openlap
}

install_release_artifact() {
  local repo="$1"
  local ref="$2"

  local asset_name="openlap.tgz"
  local download_url
  if [ "$ref" = "latest" ]; then
    download_url="https://github.com/${repo}/releases/latest/download/${asset_name}"
  else
    download_url="https://github.com/${repo}/releases/download/${ref}/${asset_name}"
  fi

  local temp_dir
  temp_dir="$(mktemp -d)"
  local tarball_path="${temp_dir}/${asset_name}"

  log "Installing openlap release artifact from ${repo} (${ref})..."
  if ! curl -fsSL "$download_url" -o "$tarball_path"; then
    rm -rf "$temp_dir"
    return 1
  fi

  npm install -g "$tarball_path"
  rm -rf "$temp_dir"
  return 0
}

install_edge_from_github() {
  local repo="$1"
  local temp_dir
  temp_dir="$(mktemp -d)"
  local checkout_path="${temp_dir}/openlap"

  log "Installing openlap from GitHub main branch (${repo})..."
  git clone --depth 1 "https://github.com/${repo}.git" "$checkout_path"
  npm --prefix "$checkout_path" install
  npm --prefix "$checkout_path" run build
  npm install -g "$checkout_path"
  rm -rf "$temp_dir"
}

fix_path_flag=false
assume_yes=false
channel="release"
ref="latest"
repo="raggle-ai/openlap"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --channel)
      if [ "$#" -lt 2 ]; then
        printf 'Error: Missing value for --channel\n' >&2
        exit 1
      fi
      channel="$2"
      shift
      ;;
    --ref)
      if [ "$#" -lt 2 ]; then
        printf 'Error: Missing value for --ref\n' >&2
        exit 1
      fi
      ref="$2"
      shift
      ;;
    --repo)
      if [ "$#" -lt 2 ]; then
        printf 'Error: Missing value for --repo\n' >&2
        exit 1
      fi
      repo="$2"
      shift
      ;;
    --fix-path)
      fix_path_flag=true
      ;;
    --yes|-y)
      assume_yes=true
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      warn "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

ensure_cmd node "Node.js is required but not installed."
ensure_cmd npm "npm is required but not installed."

case "$channel" in
  stable)
    install_stable_from_npm
    ;;
  release)
    if ! install_release_artifact "$repo" "$ref"; then
      warn "Could not download release artifact for ${repo} (${ref})."
      warn "Falling back to npm stable channel."
      install_stable_from_npm
    fi
    ;;
  edge)
    ensure_cmd git "git is required for --channel edge."
    install_edge_from_github "$repo"
    ;;
  *)
    printf 'Error: Invalid --channel value "%s". Use release, stable, or edge.\n' "$channel" >&2
    exit 1
    ;;
esac

npm_prefix="$(npm config get prefix)"
npm_bin="${npm_prefix}/bin"
shell_name="$(basename "${SHELL:-unknown}")"

if command -v openlap >/dev/null 2>&1; then
  log ""
  log "Install complete."
  log "openlap is available at: $(command -v openlap)"
  log "Run: openlap --help"
  exit 0
fi

log ""
log "Install complete, but 'openlap' is not in PATH yet."

if [ "$fix_path_flag" = true ] || [ "$assume_yes" = true ]; then
  fix_path "$shell_name" "$npm_bin" || true
elif [ -t 0 ] && prompt_yes_no "Would you like this script to update your PATH automatically?"; then
  fix_path "$shell_name" "$npm_bin" || true
fi

log ""
log "Next steps:"
log "1) Restart your terminal (or run: exec \$SHELL)"
log "2) Verify with: openlap --help"
log ""
log "If needed, add this line to your shell profile manually:"
log "  export PATH=\"${npm_bin}:\$PATH\""

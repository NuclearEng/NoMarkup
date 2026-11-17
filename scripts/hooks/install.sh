#!/usr/bin/env bash
# Opt-in installer for this repo's git hooks (currently: commit-msg, which adds
# a `Verified-by:` trailer from the verification record — see
# scripts/verify-record.mjs). Installs a small shim into the shared hooks
# directory that runs the hook from whichever worktree is committing, so every
# worktree uses its own checkout's copy and a worktree without it is a no-op.
#
#   make install-hooks     # or: bash scripts/hooks/install.sh
#   make uninstall-hooks   # or: bash scripts/hooks/install.sh --uninstall
set -euo pipefail

marker="# nomarkup-hook-shim"
if [ -n "$(git config --get core.hooksPath || true)" ]; then
  echo "core.hooksPath is set ($(git config --get core.hooksPath)); this installer only manages the default hooks directory." >&2
  echo "Point that directory's commit-msg at scripts/hooks/commit-msg yourself, or unset core.hooksPath." >&2
  exit 1
fi
hooks_dir="$(git rev-parse --git-common-dir)/hooks"
target="${hooks_dir}/commit-msg"

if [ "${1:-}" = "--uninstall" ]; then
  if [ -f "${target}" ] && grep -q "${marker}" "${target}"; then
    rm -f "${target}"
    echo "removed ${target}"
  else
    echo "no NoMarkup commit-msg shim installed at ${target}"
  fi
  exit 0
fi

if [ -e "${target}" ] && ! grep -q "${marker}" "${target}"; then
  echo "${target} already exists and is not ours; not overwriting it." >&2
  echo "Chain it yourself: call scripts/hooks/commit-msg \"\$1\" from your hook." >&2
  exit 1
fi
mkdir -p "${hooks_dir}"
cat > "${target}" <<SHIM
#!/usr/bin/env bash
${marker}
hook="\$(git rev-parse --show-toplevel)/scripts/hooks/commit-msg"
[ -x "\${hook}" ] && exec "\${hook}" "\$@"
exit 0
SHIM
chmod +x "${target}"
echo "installed ${target} -> scripts/hooks/commit-msg (Verified-by trailer, never blocks)"

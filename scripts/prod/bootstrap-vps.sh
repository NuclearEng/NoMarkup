#!/usr/bin/env bash
# Idempotent-ish VPS bootstrap for capital-light NoMarkup prod (Hetzner-class).
#
# Installs Docker Engine + Compose plugin, basic UFW rules (22/80/443),
# optional light fail2ban, and creates /opt/nomarkup for the app checkout.
#
# Usage (as root or via sudo):
#   sudo ./scripts/prod/bootstrap-vps.sh
#   sudo INSTALL_FAIL2BAN=0 ./scripts/prod/bootstrap-vps.sh   # skip fail2ban
#
# Does NOT: clone the repo, write secrets, start the stack, or open non-HTTP ports.
# No secrets in this script.
set -euo pipefail

INSTALL_FAIL2BAN="${INSTALL_FAIL2BAN:-1}"
APP_ROOT="${APP_ROOT:-/opt/nomarkup}"
DEPLOY_USER="${DEPLOY_USER:-}"

log()  { printf '[bootstrap] %s\n' "$*"; }
warn() { printf '[bootstrap] WARN: %s\n' "$*" >&2; }
die()  { printf '[bootstrap] ERROR: %s\n' "$*" >&2; exit 1; }

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    die "run as root (e.g. sudo $0)"
  fi
}

detect_os() {
  if [[ ! -f /etc/os-release ]]; then
    die "unsupported OS: /etc/os-release missing"
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) ;;
    *)
      warn "tested on Ubuntu/Debian; continuing on ID=${ID:-unknown}"
      ;;
  esac
}

apt_update_once() {
  if [[ "${_APT_UPDATED:-0}" -eq 1 ]]; then
    return 0
  fi
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  _APT_UPDATED=1
}

ensure_packages() {
  local pkgs=("$@")
  local missing=()
  local p
  for p in "${pkgs[@]}"; do
    if ! dpkg -s "$p" >/dev/null 2>&1; then
      missing+=("$p")
    fi
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    log "packages already present: ${pkgs[*]}"
    return 0
  fi
  log "installing packages: ${missing[*]}"
  apt_update_once
  apt-get install -y --no-install-recommends "${missing[@]}"
}

install_docker() {
  if command -v docker >/dev/null 2>&1 \
    && docker compose version >/dev/null 2>&1; then
    log "docker + compose plugin already installed: $(docker --version)"
    return 0
  fi

  log "installing Docker Engine + Compose plugin (official apt repo)"
  ensure_packages ca-certificates curl gnupg

  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
    curl -fsSL https://download.docker.com/linux/"${ID}"/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi

  local arch codename
  arch="$(dpkg --print-architecture)"
  codename="${VERSION_CODENAME:-${UBUNTU_CODENAME:-stable}}"
  cat >/etc/apt/sources.list.d/docker.list <<EOF
deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${codename} stable
EOF

  _APT_UPDATED=0
  apt_update_once
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  systemctl enable --now docker
  log "docker installed: $(docker --version)"
  docker compose version
}

configure_ufw() {
  ensure_packages ufw

  # Defaults: deny inbound, allow outbound. Idempotent allow rules.
  ufw default deny incoming
  ufw default allow outgoing

  ufw allow OpenSSH comment 'NoMarkup bootstrap: SSH' || ufw allow 22/tcp comment 'NoMarkup bootstrap: SSH'
  ufw allow 80/tcp  comment 'NoMarkup bootstrap: HTTP'
  ufw allow 443/tcp comment 'NoMarkup bootstrap: HTTPS'

  # Enable non-interactively if not already active.
  if ufw status | grep -q 'Status: active'; then
    log "ufw already active"
  else
    log "enabling ufw (22/80/443)"
    ufw --force enable
  fi
  ufw status numbered || true
}

configure_fail2ban() {
  if [[ "${INSTALL_FAIL2BAN}" != "1" ]]; then
    log "skipping fail2ban (INSTALL_FAIL2BAN=${INSTALL_FAIL2BAN})"
    return 0
  fi

  ensure_packages fail2ban
  # Light sshd jail only — do not invent app-layer filters.
  local local_jail=/etc/fail2ban/jail.d/nomarkup-sshd.local
  if [[ ! -f "${local_jail}" ]]; then
    cat >"${local_jail}" <<'EOF'
[sshd]
enabled = true
port    = ssh
backend = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
    log "wrote ${local_jail}"
  else
    log "fail2ban jail already present: ${local_jail}"
  fi
  systemctl enable --now fail2ban
  systemctl restart fail2ban
  log "fail2ban active (sshd jail)"
}

create_app_root() {
  mkdir -p "${APP_ROOT}"
  chmod 755 "${APP_ROOT}"

  # Optional deploy user for non-root operations after bootstrap.
  if [[ -n "${DEPLOY_USER}" ]]; then
    if id "${DEPLOY_USER}" >/dev/null 2>&1; then
      log "deploy user exists: ${DEPLOY_USER}"
    else
      log "creating deploy user: ${DEPLOY_USER}"
      useradd --create-home --shell /bin/bash "${DEPLOY_USER}"
    fi
    usermod -aG docker "${DEPLOY_USER}" || true
    chown "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_ROOT}"
  fi

  log "app root ready: ${APP_ROOT}"
}

print_non_root_notes() {
  cat <<'EOF'

=== Non-root ops notes ===
1. Prefer a dedicated deploy user (re-run with DEPLOY_USER=deploy) and SSH key auth.
2. Disable password SSH login once keys work (/etc/ssh/sshd_config: PasswordAuthentication no).
3. Never run the app containers as root inside the image when avoidable; host docker group
   is powerful — treat members as root-equivalent.
4. Keep secrets only in ${APP_ROOT}/.env (mode 600), never in git or this script.
5. Next steps:
     - clone/copy the repo into /opt/nomarkup (or set APP_ROOT)
     - copy production .env into place (see scripts/prod/README.md)
     - run scripts/prod/deploy.sh
     - run scripts/prod/smoke.sh
     - schedule scripts/prod/backup-pg.sh via cron

EOF
}

main() {
  require_root
  detect_os
  log "starting VPS bootstrap (APP_ROOT=${APP_ROOT})"
  ensure_packages ca-certificates curl gnupg apt-transport-https
  install_docker
  configure_ufw
  configure_fail2ban
  create_app_root
  print_non_root_notes
  log "bootstrap complete"
}

main "$@"

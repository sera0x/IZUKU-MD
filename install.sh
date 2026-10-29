#!/usr/bin/env bash
# IZUKU-MD installer — one line:
#   bash <(curl -fsSL https://pair.dkit.name.ng/install.sh)
#
# Fixed install location (no prompt). Override with env vars or flags:
#   IZUKU_DIR=/srv/izuku OWNER_NUMBER=2348012345678 SESSION_ID=IZUKU-XXXX \
#     bash install.sh -y --start
set -euo pipefail

REPO_URL="${IZUKU_REPO:-https://github.com/sera0x/IZUKU-MD.git}"
DIR="${IZUKU_DIR:-$HOME/izuku}"
PAIR_SERVER="${PAIR_SERVER:-https://pair.dkit.name.ng}"
NODE_MAJOR_MIN="${NODE_MAJOR_MIN:-20}"
NONINTERACTIVE="${NONINTERACTIVE:-0}"
START_AFTER_INSTALL="${START_AFTER_INSTALL:-0}"
OWNER_NUMBER="${OWNER_NUMBER:-}"
SESSION_ID="${SESSION_ID:-}"
LOG_FILE="${IZUKU_LOG:-$PWD/izuku-install.log}"
INSTALL_SUCCESS=0
PM2_NAME="${PM2_NAME:-IZUKU-MD}"

OS_TYPE="linux"
PKG=""
PRIV=""
NEED=()

# ── output ───────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != "dumb" ]; then
    C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
    C_CYAN=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_DIM=""; C_OFF=""
fi

say()  { printf '%s\n' "$*" >&2; echo "$*" >>"$LOG_FILE"; }
info() { printf '%s[..]%s %s\n' "$C_CYAN" "$C_OFF" "$*" >&2; echo "[..] $*" >>"$LOG_FILE"; }
ok()   { printf '%s[ok]%s %s\n' "$C_GREEN" "$C_OFF" "$*" >&2; echo "[ok] $*" >>"$LOG_FILE"; }
warn() { printf '%s[!!]%s %s\n' "$C_YELLOW" "$C_OFF" "$*" >&2; echo "[!!] $*" >>"$LOG_FILE"; }
die()  { printf '%s[xx]%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; echo "[xx] $*" >>"$LOG_FILE"; exit 1; }

on_exit() {
    local rc=$?
    if [ "$INSTALL_SUCCESS" -ne 1 ] && [ "$rc" -ne 0 ]; then
        printf '\n%sInstallation failed (exit %s). Last lines of %s:%s\n' "$C_RED" "$rc" "$LOG_FILE" "$C_OFF" >&2
        tail -20 "$LOG_FILE" >&2 2>/dev/null || true
    fi
}
trap on_exit EXIT

run_priv() {
    if [ "$(id -u)" -eq 0 ]; then "$@"; else $PRIV "$@"; fi
}

# ── arguments ────────────────────────────────────────────────────────────
usage() {
    cat <<EOF
Usage: install.sh [options]

  -y, --non-interactive   never prompt (use OWNER_NUMBER / SESSION_ID env)
      --start             start the bot after install
      --dir PATH          install directory (default: \$HOME/izuku)
      --number NUMBER     owner WhatsApp number, digits only
      --session ID        SESSION_ID from the pairing site
  -h, --help              this help

Environment: IZUKU_DIR, OWNER_NUMBER, SESSION_ID, IZUKU_REPO, PAIR_SERVER,
             NONINTERACTIVE, START_AFTER_INSTALL
EOF
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            -y|--non-interactive) NONINTERACTIVE=1; shift ;;
            --start)              START_AFTER_INSTALL=1; shift ;;
            --dir)                DIR="${2:?--dir needs a path}"; shift 2 ;;
            --number)             OWNER_NUMBER="${2:?--number needs a value}"; shift 2 ;;
            --session)            SESSION_ID="${2:?--session needs a value}"; shift 2 ;;
            -h|--help)            usage; INSTALL_SUCCESS=1; exit 0 ;;
            *) die "unknown option: $1 (try --help)" ;;
        esac
    done
    if [ -n "${CI:-}" ]; then NONINTERACTIVE=1; fi
    return 0
}

# ── os / packages ────────────────────────────────────────────────────────
detect_os() {
    case "$(uname -s)" in
        Darwin)
            OS_TYPE="darwin"
            command -v brew >/dev/null 2>&1 || die "Homebrew is required on macOS: https://brew.sh"
            PKG="brew"
            return 0
            ;;
        Linux) ;;
        *) die "unsupported OS: $(uname -s) — use Linux, WSL, macOS or Termux" ;;
    esac

    if [ -n "${TERMUX_VERSION:-}" ] || [ -d /data/data/com.termux ]; then
        OS_TYPE="termux"; PKG="pkg"; return 0
    fi
    if grep -qi microsoft /proc/version 2>/dev/null; then OS_TYPE="wsl"; fi

    [ -r /etc/os-release ] || die "cannot detect distro (/etc/os-release missing)"
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}:${ID_LIKE:-}" in
        debian*|ubuntu*|*debian*|*ubuntu*|pop*|linuxmint*|raspbian*|kali*|zorin*) PKG="apt" ;;
        fedora*|rhel*|centos*|rocky*|alma*|ol*|*fedora*|*rhel*)              PKG="dnf" ;;
        arch*|manjaro*|endeavouros*|garuda*|*arch*)                          PKG="pacman" ;;
        alpine*|*alpine*)                                                    PKG="apk" ;;
        *) die "unsupported distro: ${PRETTY_NAME:-${ID:-unknown}}" ;;
    esac
}

have() { command -v "$1" >/dev/null 2>&1; }

check_prereqs() {
    info "checking prerequisites"
    NEED=()
    have git   || NEED+=("git")
    have curl  || NEED+=("curl")
    have unzip || NEED+=("unzip")
    have ffmpeg || NEED+=("ffmpeg")
    if ! have gcc || ! have make; then NEED+=("build tools"); fi
    have python3 || have python || NEED+=("python3")

    local node_major=0
    if have node; then node_major="$(node -v | sed 's/^v//' | cut -d. -f1)"; fi
    if [ "${node_major:-0}" -lt "$NODE_MAJOR_MIN" ] 2>/dev/null; then
        NEED+=("node ${NODE_MAJOR_MIN}+")
    fi

    if [ "${#NEED[@]}" -eq 0 ]; then
        ok "all prerequisites present"
    else
        info "will install: ${NEED[*]}"
    fi
}

install_system_deps() {
    if [ "${#NEED[@]}" -eq 0 ]; then return 0; fi

    local want_build=0 want_python=0
    local p
    for p in "${NEED[@]}"; do
        case "$p" in
            "build tools") want_build=1 ;;
            python3)       want_python=1 ;;
        esac
    done

    info "installing system packages with $PKG"
    case "$PKG" in
        apt)
            run_priv apt-get update -y >>"$LOG_FILE" 2>&1
            local pkgs="git curl unzip ffmpeg"
            if [ "$want_build" -eq 1 ]; then pkgs="$pkgs build-essential"; fi
            if [ "$want_python" -eq 1 ]; then pkgs="$pkgs python3"; fi
            DEBIAN_FRONTEND=noninteractive run_priv apt-get install -y $pkgs >>"$LOG_FILE" 2>&1
            ;;
        dnf)
            local pkgs="git curl unzip"
            if [ "$want_build" -eq 1 ]; then pkgs="$pkgs gcc gcc-c++ make"; fi
            if [ "$want_python" -eq 1 ]; then pkgs="$pkgs python3"; fi
            run_priv dnf install -y $pkgs >>"$LOG_FILE" 2>&1 || run_priv dnf install -y ffmpeg-free >>"$LOG_FILE" 2>&1 || true
            ;;
        pacman)
            local pkgs="git curl unzip ffmpeg"
            if [ "$want_build" -eq 1 ]; then pkgs="$pkgs base-devel"; fi
            if [ "$want_python" -eq 1 ]; then pkgs="$pkgs python"; fi
            run_priv pacman -Sy --noconfirm --needed $pkgs >>"$LOG_FILE" 2>&1
            ;;
        apk)
            local pkgs="git curl unzip ffmpeg"
            if [ "$want_build" -eq 1 ]; then pkgs="$pkgs build-base"; fi
            if [ "$want_python" -eq 1 ]; then pkgs="$pkgs python3"; fi
            run_priv apk add --no-cache $pkgs >>"$LOG_FILE" 2>&1
            ;;
        pkg)
            run_priv pkg update -y >>"$LOG_FILE" 2>&1 || true
            run_priv pkg install -y git curl unzip ffmpeg python binutils >>"$LOG_FILE" 2>&1 || true
            ;;
        brew)
            local pkgs=""
            if [ "$want_python" -eq 1 ]; then pkgs="$pkgs python3"; fi
            if [ -n "$pkgs" ]; then brew install $pkgs >>"$LOG_FILE" 2>&1 || true; fi
            ;;
    esac
    ok "system packages ready"
}

install_node() {
    local major=0
    if have node; then major="$(node -v | sed 's/^v//' | cut -d. -f1)"; fi
    [ "${major:-0}" -ge "$NODE_MAJOR_MIN" ] 2>/dev/null && { ok "node $(node -v)"; return 0; }

    info "installing node ${NODE_MAJOR_MIN}.x"
    case "$PKG" in
        apt|dnf)
            local url
            if [ "$PKG" = "apt" ]; then url="https://deb.nodesource.com/setup_${NODE_MAJOR_MIN}.x"
            else url="https://rpm.nodesource.com/setup_${NODE_MAJOR_MIN}.x"; fi
            curl -fsSL -o /tmp/nodesource_setup.sh "$url" >>"$LOG_FILE" 2>&1
            run_priv bash /tmp/nodesource_setup.sh >>"$LOG_FILE" 2>&1
            rm -f /tmp/nodesource_setup.sh
            run_priv "$PKG" install -y nodejs >>"$LOG_FILE" 2>&1
            ;;
        pacman) run_priv pacman -Sy --noconfirm nodejs npm >>"$LOG_FILE" 2>&1 ;;
        apk)    run_priv apk add --no-cache nodejs npm >>"$LOG_FILE" 2>&1 ;;
        pkg)    run_priv pkg install -y nodejs >>"$LOG_FILE" 2>&1 ;;
        brew)   brew install node >>"$LOG_FILE" 2>&1 ;;
    esac
    have node || die "node install failed — see $LOG_FILE"
    ok "node $(node -v)"
}

install_pm2() {
    if have pm2; then ok "pm2 $(pm2 -v 2>/dev/null | tail -1)"; return 0; fi
    info "installing pm2"
    run_priv npm install -g pm2 --no-audit --no-fund >>"$LOG_FILE" 2>&1 || die "pm2 install failed"
    ok "pm2 installed"
}

# ── code ─────────────────────────────────────────────────────────────────
fetch_code() {
    if [ -d "$DIR/.git" ]; then
        info "updating $DIR"
        if ! git -C "$DIR" fetch --depth 1 origin main >>"$LOG_FILE" 2>&1 ||
           ! git -C "$DIR" reset --hard origin/main >>"$LOG_FILE" 2>&1; then
            warn "update failed, keeping the existing checkout"
            git -C "$DIR" reset --hard HEAD >>"$LOG_FILE" 2>&1 || true
        fi
    elif [ -f "$DIR/package.json" ]; then
        warn "$DIR has no .git — using it as is"
    else
        info "cloning $REPO_URL"
        rm -rf "$DIR"
        git clone --depth 1 "$REPO_URL" "$DIR" >>"$LOG_FILE" 2>&1 ||
            die "clone failed (check network / repo access)"
    fi
    [ -f "$DIR/package.json" ] || die "$DIR does not look like IZUKU-MD"
    cd "$DIR"
    ok "code ready at $DIR"
}

install_deps() {
    info "installing dependencies with ${IZUKU_PM:-npm} (postinstall also builds dist/)"
    # tsc does not delete output for sources that were removed, so a stale dist/
    # keeps loading old command files ("Duplicate command: setgcpp"). Build clean.
    rm -rf dist

    # npm is the safe default (native modules build the same way as production).
    # IZUKU_PM=bun is much faster but relies on bun's node-gyp fallback.
    local installed=0
    if [ "${IZUKU_PM:-npm}" = "bun" ] && have bun; then
        info "using bun install (fast path)"
        if bun install --frozen-lockfile >>"$LOG_FILE" 2>&1 || bun install >>"$LOG_FILE" 2>&1; then
            installed=1
        else
            warn "bun install failed — falling back to npm"
        fi
    fi

    if [ "$installed" -eq 0 ] && ! npm install --no-audit --no-fund --prefer-offline --no-progress >>"$LOG_FILE" 2>&1; then
        warn "npm install failed — retrying after installing build tools"
        case "$PKG" in
            apt)    run_priv apt-get install -y build-essential python3 >>"$LOG_FILE" 2>&1 ;;
            dnf)    run_priv dnf install -y gcc gcc-c++ make python3 >>"$LOG_FILE" 2>&1 ;;
            pacman) run_priv pacman -Sy --noconfirm base-devel python >>"$LOG_FILE" 2>&1 ;;
            apk)    run_priv apk add --no-cache build-base python3 >>"$LOG_FILE" 2>&1 ;;
        esac
        npm install --no-audit --no-fund --prefer-offline --no-progress >>"$LOG_FILE" 2>&1 || die "npm install failed — see $LOG_FILE"
    fi

    # dist/ is what `npm start` runs on plain node.
    if [ ! -f dist/src/index.js ]; then
        info "building dist/"
        npm run build >>"$LOG_FILE" 2>&1 || die "build failed — see $LOG_FILE"
    fi
    ok "dependencies installed"
}

# ── config ───────────────────────────────────────────────────────────────
set_env() {
    local key="$1" value="$2"
    awk -v k="$key" -v v="$value" '
        index($0, k "=") == 1 { print k "=" v; found = 1; next }
        { print }
        END { if (!found) print k "=" v }
    ' config.env >config.env.izuku-tmp && mv config.env.izuku-tmp config.env
}

read_config_value() {
    local file="${2:-config.env}"
    [ -f "$file" ] || return 0
    sed -n "s/^$1=//p" "$file" | head -1
}

# A relative --dir like "izuku-plain" breaks pm2 --cwd and config lookups later,
# so resolve it against the current directory once, up front.
resolve_dir() {
    case "$1" in
        /*) printf '%s' "$1" ;;
        *) printf '%s/%s' "$(pwd)" "$1" ;;
    esac
}

pm2_name_taken() {
    pm2 describe "$1" >/dev/null 2>&1
}

# Every deployed bot needs its own pm2 name, otherwise starting a second one
# replaces the first. "IZUKU-MD" then "IZUKU-MD-1", "IZUKU-MD-2", …
next_free_pm2_name() {
    local base="$1" n=1
    if ! pm2_name_taken "$base"; then printf '%s' "$base"; return 0; fi
    while pm2_name_taken "$base-$n"; do n=$((n + 1)); done
    printf '%s' "$base-$n"
}

# Ask for the owner number and session id BEFORE anything is installed, so the
# installer does not spend minutes on npm while the user is still waiting to be
# asked for their details.
collect_inputs() {
    local file=""
    local reusing=0
    BOT_NAME="${BOT_NAME:-IZUKU-MD}"
    if [ -f "$DIR/config.env" ]; then
        file="$DIR/config.env"
    elif [ -f "$DIR/.env" ]; then
        file="$DIR/.env"
    fi

    # An existing config means this box already runs a bot for someone. Ask
    # before touching it: reusing it silently was how a deploy for a new client
    # ended up pointed at the previous client's number and session.
    if [ -n "$file" ] && [ "$NONINTERACTIVE" -ne 1 ] && [ -t 0 ]; then
        local had_number had_session
        had_number="$(read_config_value OWNER_NUMBER "$file")"
        had_session="$(read_config_value SESSION_ID "$file")"
        say ""
        say "An existing config was found in $DIR"
        if [ -n "$had_number" ]; then say "  owner:   $had_number"; fi
        if [ -n "$had_session" ]; then say "  session: already set"; else say "  session: not set"; fi
        say ""
        ask "Continue with this bot, or deploy a NEW one? [c]ontinue / [n]ew:" "c"
        case "$REPLY" in
            n|N|new|NEW)
                # A new bot needs its own directory: sharing one would share the
                # session folder and the two accounts would fight over it.
                local suggested="${DIR}-new"
                ask "Directory for the new bot:" "$suggested"
                DIR="$REPLY"
                OWNER_NUMBER=""
                SESSION_ID=""
                say "  new bot will be installed in $DIR"
                ;;
            *)
                reusing=1
                local stored
                stored="$(read_config_value BOT_NAME "$file")"
                if [ -n "$stored" ]; then BOT_NAME="$stored"; fi
                say "  continuing with the existing bot in $DIR"
                ;;
        esac
    fi

    if [ "$reusing" -eq 1 ]; then
        # Keep the name the running bot already uses.
        PM2_NAME="${PM2_NAME:-$BOT_NAME}"
    else
        ask "Bot name (also the pm2 service name):" "$BOT_NAME"
        BOT_NAME="${REPLY:-$BOT_NAME}"
        PM2_NAME="$(next_free_pm2_name "$BOT_NAME")"
        if [ "$PM2_NAME" != "$BOT_NAME" ]; then
            say "  $BOT_NAME is already taken — this bot will run as $PM2_NAME"
        fi
    fi

    if [ -z "$OWNER_NUMBER" ] && [ -n "$file" ] && [ "$DIR" = "$(dirname "$file")" ]; then
        OWNER_NUMBER="$(read_config_value OWNER_NUMBER "$file")"
    fi
    if [ -z "$SESSION_ID" ] && [ -n "$file" ] && [ "$DIR" = "$(dirname "$file")" ]; then
        SESSION_ID="$(read_config_value SESSION_ID "$file")"
    fi

    if [ -z "$OWNER_NUMBER" ]; then
        ask "Bot WhatsApp number (digits with country code, e.g. 2348012345678):"
        OWNER_NUMBER="$(printf '%s' "$REPLY" | tr -cd '0-9')"
    fi
    if [ -z "$SESSION_ID" ]; then
        ask "SESSION_ID from the pairing site (blank = pair with a code at startup):"
        SESSION_ID="$REPLY"
    fi

    say ""
    say "installing now — this takes a few minutes:"
    say "  dir:     $DIR"
    say "  name:    $PM2_NAME"
    if [ -n "$OWNER_NUMBER" ]; then say "  owner:   $OWNER_NUMBER"; fi
    if [ -n "$SESSION_ID" ]; then say "  session: ${SESSION_ID:0:12}…"; fi
    say ""
}

ask() {
    # ask <prompt> <default> -> sets REPLY, empty default allowed
    local prompt="$1" default="${2:-}"
    REPLY="$default"
    if [ "$NONINTERACTIVE" -eq 1 ] || [ ! -t 0 ]; then return 0; fi
    if [ -n "$default" ]; then
        printf '%s\n  [%s]: ' "$prompt" "$default" >&2
    else
        printf '%s\n  > ' "$prompt" >&2
    fi
    local reply=""
    read -r reply || true
    if [ -n "$reply" ]; then REPLY="$reply"; fi
    return 0
}

configure() {
    if [ ! -f config.env ] && [ -f .env ]; then
        mv .env config.env
        ok "migrated .env to config.env"
    fi
    if [ ! -f config.env ] && [ -f config.env.example ]; then
        cp config.env.example config.env
    fi
    [ -f config.env ] || : >config.env
    chmod 600 config.env 2>/dev/null || true

    local current_number current_session
    current_number="$(read_config_value OWNER_NUMBER)"
    current_session="$(read_config_value SESSION_ID)"

    if [ -z "$OWNER_NUMBER" ]; then OWNER_NUMBER="$current_number"; fi
    if [ -z "$SESSION_ID" ]; then SESSION_ID="$current_session"; fi

    if [ -z "$OWNER_NUMBER" ]; then
        ask "Bot WhatsApp number (digits with country code, e.g. 2348012345678):"
        OWNER_NUMBER="$REPLY"
    fi
    if [ -z "$SESSION_ID" ]; then
        ask "SESSION_ID from the pairing site (blank = pair with a code at startup):"
        SESSION_ID="$REPLY"
    fi

    if [ -n "$BOT_NAME" ]; then
        set_env BOT_NAME "$BOT_NAME"
    fi
    if [ -n "$OWNER_NUMBER" ]; then
        set_env OWNER_NUMBER "$(printf '%s' "$OWNER_NUMBER" | tr -cd '0-9')"
    fi
    if [ -n "$SESSION_ID" ]; then
        set_env SESSION_ID "$SESSION_ID"
    elif [ -n "$OWNER_NUMBER" ]; then
        set_env PAIRING_NUMBER "$OWNER_NUMBER"
    fi

    # Short IZUKU-XXXXXXXXXXXX ids are turned into credentials over HTTP, so the
    # address must be present or the bot falls back to a QR code.
    if ! grep -qE '^PAIR_SERVER=.+' config.env; then
        set_env PAIR_SERVER "$PAIR_SERVER"
    fi

    # Anchor validation compares DEPLOYMENT_KEY with the dkit registry; a stale
    # key makes every boot fail. Sync it when dkit is available and not busy.
    if have dkit; then
        local dkit_env="${DKIT_ENV:-production}" key profile
        key="$(dkit env:get -e "$dkit_env" DEPLOYMENT_KEY 2>/dev/null | sed -n 's/^DEPLOYMENT_KEY=//p' | head -1)"
        if [ -n "$key" ]; then
            set_env DEPLOYMENT_KEY "$key"
            ok "DEPLOYMENT_KEY synced from dkit"
        else
            warn "dkit is busy, DEPLOYMENT_KEY not synced (run: dkit env:get -e $dkit_env DEPLOYMENT_KEY)"
        fi
        profile="$(dkit env:get -e "$dkit_env" RUNTIME_PROFILE 2>/dev/null | sed -n 's/^RUNTIME_PROFILE=//p' | head -1)"
        if [ -n "$OWNER_NUMBER" ] && [ -n "$profile" ] && [ "$OWNER_NUMBER" != "$profile" ]; then
            warn "OWNER_NUMBER does not match the sealed RUNTIME_PROFILE — startup validation will refuse to run"
        fi
    fi
    ok "config.env ready"
}

# ── start ────────────────────────────────────────────────────────────────
start_bot() {
    # Never delete a pm2 app that belongs to another directory/bot.
    local existing_cwd
    existing_cwd="$(pm2 describe "$PM2_NAME" 2>/dev/null | awk -F'│' '/exec cwd/{gsub(/^ +| +$/,"",$3); print $3}')"
    if [ -n "$existing_cwd" ] && [ "$existing_cwd" != "$DIR" ]; then
        local replacement
        replacement="$(next_free_pm2_name "$PM2_NAME")"
        warn "$PM2_NAME already runs $existing_cwd — using $replacement instead"
        PM2_NAME="$replacement"
    fi

    info "starting $PM2_NAME under pm2"
    pm2 delete "$PM2_NAME" >>"$LOG_FILE" 2>&1 || true
    pm2 start npm --name "$PM2_NAME" --cwd "$DIR" -- start >>"$LOG_FILE" 2>&1 || die "pm2 start failed"
    pm2 save >>"$LOG_FILE" 2>&1 || true
    # Register the boot hook without restarting pm2 (avoids cutting this session).
    pm2 startup systemd -u "$(id -un)" --hp "$HOME" >>"$LOG_FILE" 2>&1 || true

    sleep 8
    local status
    status="$(pm2 describe "$PM2_NAME" 2>/dev/null | awk -F'│' '/status/{gsub(/ /,"",$3); print $3; exit}')"
    if [ "$status" = "online" ]; then
        ok "$PM2_NAME is online"
    else
        warn "$PM2_NAME is not online yet ($status) — check: pm2 logs $PM2_NAME"
    fi
}

main() {
    : >"$LOG_FILE"
    parse_args "$@"
    say "IZUKU-MD installer"
    DIR="$(resolve_dir "$DIR")"
    detect_os
    if [ "$(id -u)" -ne 0 ] && [ "$OS_TYPE" != "termux" ]; then
        if have sudo; then PRIV="sudo"; else PRIV=""; fi
    fi
    # Ask first, install after.
    collect_inputs
    check_prereqs
    install_system_deps
    install_node
    install_pm2
    fetch_code
    install_deps
    configure
    start_bot

    INSTALL_SUCCESS=1
    say ""
    ok "IZUKU-MD installed at $DIR and running under pm2"
    say "  logs:    pm2 logs $PM2_NAME"
    say "  restart: pm2 restart $PM2_NAME"
    say "  stop:    pm2 stop $PM2_NAME"
    if [ -z "$(read_config_value SESSION_ID)" ]; then
        say "  no session id: open 'pm2 logs $PM2_NAME' and enter the pairing code in WhatsApp > Linked devices"
    fi
}

main "$@"

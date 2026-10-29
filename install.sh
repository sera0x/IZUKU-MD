#!/usr/bin/env bash
# IZUKU-MD one-line VPS installer
set -euo pipefail

# Fixed install location. Override without being prompted:
#   IZUKU_DIR=/srv/izuku bash install.sh
DIR="${IZUKU_DIR:-$HOME/izuku}"

echo "🐾 IZUKU-MD installer"
echo

read -rp "Bot WhatsApp number (digits with country code, e.g. 2348012345678): " NUM || NUM=""
read -rp "Session id from pair.dkit.name.ng (leave empty to pair with a code at startup): " SID || SID=""

echo
echo "installing now, this takes a few minutes:"
echo "  node 20, ffmpeg, pm2"
echo "  IZUKU-MD into $DIR"
if [ -n "$NUM" ]; then echo "  owner: $NUM"; fi
if [ -n "$SID" ]; then echo "  session id: ${SID:0:8}..."; fi
echo

# ── 1. system deps ───────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
    echo "⚙️ installing node 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
    apt-get install -y nodejs >/dev/null
fi
echo "✅ node $(node -v)"

if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "⚙️ installing ffmpeg..."
    apt-get update -qq >/dev/null
    apt-get install -y ffmpeg >/dev/null
fi
echo "✅ ffmpeg"

if ! command -v git >/dev/null 2>&1; then
    apt-get update -qq >/dev/null
    apt-get install -y git >/dev/null
fi

if ! command -v pm2 >/dev/null 2>&1; then
    echo "⚙️ installing pm2..."
    npm install -g pm2 --no-audit --no-fund >/dev/null
fi
echo "✅ pm2"

# ── 2. code ──────────────────────────────────────────────────────────────
if [ -d "$DIR/.git" ]; then
    echo "⚙️ updating IZUKU-MD..."
    git -C "$DIR" pull --ff-only >/dev/null 2>&1 || true
elif [ ! -f "$DIR/package.json" ]; then
    echo "⚙️ downloading IZUKU-MD..."
    git clone --depth 1 https://github.com/sera0x/IZUKU-MD.git "$DIR" 2>/dev/null || {
        rm -rf "$DIR" && mkdir -p "$DIR" && cd "$DIR"
        apt-get install -y -qq unzip >/dev/null
        curl -fsSL https://pair.dkit.name.ng/download -o izuku.zip && unzip -qo izuku.zip && rm izuku.zip
    }
fi
cd "$DIR"

# ── 3. dependencies (npm) ────────────────────────────────────────────────
# npm also runs postinstall (baileys patch + tsc build), so no separate build.
echo "⚙️ installing dependencies (npm)..."
if ! npm install --no-audit --no-fund --prefer-offline >/dev/null 2>&1; then
    echo "⚙️ npm needs build tools for native modules, retrying..."
    apt-get update -qq >/dev/null
    apt-get install -y -qq build-essential python3 >/dev/null
    npm install --no-audit --no-fund
fi
echo "✅ dependencies installed"

# ── 4. config ────────────────────────────────────────────────────────────
# config.env is the current name; migrate an existing .env instead of
# overwriting someone's settings.
if [ ! -f config.env ] && [ -f .env ]; then
    mv .env config.env
fi
if [ ! -f config.env ]; then
    cp config.env.example config.env 2>/dev/null || cp .env.example config.env
fi

set_env() {
    local key="$1" value="$2"
    awk -v k="$key" -v v="$value" '
        index($0, k "=") == 1 { print k "=" v; found = 1; next }
        { print }
        END { if (!found) print k "=" v }
    ' config.env > config.env.izuku-tmp && mv config.env.izuku-tmp config.env
}

if [ -n "$NUM" ]; then set_env OWNER_NUMBER "$NUM"; fi
if [ -n "$SID" ]; then
    set_env SESSION_ID "$SID"
elif [ -n "$NUM" ]; then
    set_env PAIRING_NUMBER "$NUM"
fi

# Short IZUKU-XXXXXXXXXXXX ids are resolved through the pairing site, so the
# bot needs its address to turn the id into credentials.
if ! grep -qE '^PAIR_SERVER=.+' config.env; then
    set_env PAIR_SERVER "https://pair.dkit.name.ng"
fi

# The anchor check compares DEPLOYMENT_KEY with the dkit registry. A stale key
# in an existing config.env makes every boot fail, so keep it in sync when dkit is
# available on this machine.
if command -v dkit >/dev/null 2>&1; then
    DKIT_KEY="$(dkit env:get -e "${DKIT_ENV:-production}" DEPLOYMENT_KEY 2>/dev/null | sed -n 's/^DEPLOYMENT_KEY=//p' | head -1)"
    if [ -n "$DKIT_KEY" ]; then
        set_env DEPLOYMENT_KEY "$DKIT_KEY"
        echo "✅ deployment key synced from dkit"
    else
        echo "⚠️ dkit is busy, could not sync DEPLOYMENT_KEY (run: dkit env:get -e production DEPLOYMENT_KEY)"
    fi
    DKIT_PROFILE="$(dkit env:get -e "${DKIT_ENV:-production}" RUNTIME_PROFILE 2>/dev/null | sed -n 's/^RUNTIME_PROFILE=//p' | head -1)"
    if [ -n "$NUM" ] && [ -n "$DKIT_PROFILE" ] && [ "$NUM" != "$DKIT_PROFILE" ]; then
        echo "⚠️ OWNER_NUMBER $NUM does not match the sealed RUNTIME_PROFILE; startup validation will refuse to run"
    fi
fi

# ── 5. start ─────────────────────────────────────────────────────────────
pm2 delete IZUKU-MD >/dev/null 2>&1 || true
pm2 start npm --name IZUKU-MD --cwd "$DIR" -- start >/dev/null
pm2 save >/dev/null 2>&1 || true
pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null 2>&1 || true

echo
echo "✅ IZUKU-MD installed at $DIR and running under pm2"
if [ -z "$SID" ]; then
    echo "▶ no session id set: run 'pm2 logs IZUKU-MD' and enter the pairing code shown, in WhatsApp linked devices"
fi
echo "▶ commands: pm2 logs IZUKU-MD | pm2 restart IZUKU-MD | pm2 stop IZUKU-MD"

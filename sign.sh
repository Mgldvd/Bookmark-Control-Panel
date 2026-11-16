#!/usr/bin/env sh
# Signs the extension on addons.mozilla.org through the "unlisted" channel (private: it is
# not published in the store) and leaves the signed .xpi in dist/. That .xpi installs
# permanently in regular Firefox: about:addons → ⚙️ → "Install Add-on From File".
#
# Requires AMO API credentials (https://addons.mozilla.org/developers/addon/api/key/)
# in a .env file next to this script (ignored by git; see .env.example):
#   WEB_EXT_API_KEY='user:12345:678'   # "JWT issuer"
#   WEB_EXT_API_SECRET='…'             # "JWT secret"
# or exported in the terminal (they take precedence over .env). Then:
#   ./sign.sh            # packages and signs
#   ./sign.sh --check    # only checks that the credentials load
#
# Uses Mozilla's official web-ext tool via npx (only for signing; it is not part
# of the extension). Each signature needs a new "version" in manifest.json.
set -eu

cd "$(dirname "$0")"

# Credentials from .env (ignored by git) unless already in the environment.
# They are read as text (KEY=value), without executing the file.
if [ -f .env ]; then
  CR=$(printf '\r')
  while IFS='=' read -r key value || [ -n "$key" ]; do
    value=${value%"$CR"}
    value=${value#\'}; value=${value%\'}
    value=${value#\"}; value=${value%\"}
    case "$key" in
      WEB_EXT_API_KEY) [ -n "${WEB_EXT_API_KEY:-}" ] || export WEB_EXT_API_KEY="$value" ;;
      WEB_EXT_API_SECRET) [ -n "${WEB_EXT_API_SECRET:-}" ] || export WEB_EXT_API_SECRET="$value" ;;
    esac
  done < .env
fi

: "${WEB_EXT_API_KEY:?Missing WEB_EXT_API_KEY (AMO JWT issuer): put it in .env or export it}"
: "${WEB_EXT_API_SECRET:?Missing WEB_EXT_API_SECRET (AMO JWT secret): put it in .env or export it}"

# ./sign.sh --check → only checks that there are credentials, without packaging or signing.
if [ "${1:-}" = "--check" ]; then
  echo "Credentials loaded: WEB_EXT_API_KEY (${#WEB_EXT_API_KEY} characters), WEB_EXT_API_SECRET (${#WEB_EXT_API_SECRET} characters)."
  exit 0
fi

VERSION=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' manifest.json | head -n 1)
ZIP="dist/bookmark-control-panel-${VERSION}.zip"

# Exactly the package contents are signed (no README, scripts or .git).
./package.sh
BUILD=$(mktemp -d)
ARTIFACTS=$(mktemp -d)
trap 'rm -rf "$BUILD" "$ARTIFACTS"' EXIT INT TERM
unzip -q "$ZIP" -d "$BUILD"

echo "Signing version ${VERSION} on AMO (unlisted channel)…"
npx --yes web-ext@10.8.0 sign \
  --channel=unlisted \
  --source-dir="$BUILD" \
  --artifacts-dir="$ARTIFACTS"

# web-ext uses an internal name; it is renamed to a readable one.
SIGNED=$(ls -1t "$ARTIFACTS"/*.xpi | head -n 1)
OUT="dist/bookmark-control-panel-${VERSION}-signed.xpi"
mv "$SIGNED" "$OUT"
echo "Done. Signed .xpi: $OUT"

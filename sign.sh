#!/usr/bin/env sh
# Firma la extensión en addons.mozilla.org por el canal «unlisted» (privado: no se
# publica en la tienda) y deja el .xpi firmado en dist/. Ese .xpi se instala de
# forma permanente en Firefox normal: about:addons → ⚙️ → «Instalar desde archivo».
#
# Requiere credenciales de API de AMO (https://addons.mozilla.org/developers/addon/api/key/)
# en un archivo .env junto a este script (ignorado por git; ver .env.example):
#   WEB_EXT_API_KEY='user:12345:678'   # «Emisor JWT»
#   WEB_EXT_API_SECRET='…'             # «Secreto JWT»
# o exportadas en la terminal (tienen prioridad sobre .env). Luego:
#   ./sign.sh            # empaqueta y firma
#   ./sign.sh --check    # solo comprueba que las credenciales se cargan
#
# Usa la herramienta oficial web-ext de Mozilla vía npx (solo para firmar; no forma
# parte de la extensión). Cada firma necesita un "version" nuevo en manifest.json.
set -eu

cd "$(dirname "$0")"

# Credenciales desde .env (ignorado por git) si no vienen ya en el entorno.
# Se leen como texto (KEY=valor), sin ejecutar el archivo.
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

: "${WEB_EXT_API_KEY:?Falta WEB_EXT_API_KEY (Emisor JWT de AMO): ponlo en .env o expórtalo}"
: "${WEB_EXT_API_SECRET:?Falta WEB_EXT_API_SECRET (Secreto JWT de AMO): ponlo en .env o expórtalo}"

# ./sign.sh --check → solo comprueba que hay credenciales, sin empaquetar ni firmar.
if [ "${1:-}" = "--check" ]; then
  echo "Credenciales cargadas: WEB_EXT_API_KEY (${#WEB_EXT_API_KEY} caracteres), WEB_EXT_API_SECRET (${#WEB_EXT_API_SECRET} caracteres)."
  exit 0
fi

VERSION=$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' manifest.json | head -n 1)
ZIP="dist/bookmark-dashboard-${VERSION}.zip"

# Se firma exactamente el contenido del paquete (sin README, scripts ni .git).
./package.sh
BUILD=$(mktemp -d)
ARTIFACTS=$(mktemp -d)
trap 'rm -rf "$BUILD" "$ARTIFACTS"' EXIT INT TERM
unzip -q "$ZIP" -d "$BUILD"

echo "Firmando la versión ${VERSION} en AMO (canal unlisted)…"
npx --yes web-ext@10.8.0 sign \
  --channel=unlisted \
  --source-dir="$BUILD" \
  --artifacts-dir="$ARTIFACTS"

# web-ext usa un nombre interno; se renombra a uno legible.
SIGNED=$(ls -1t "$ARTIFACTS"/*.xpi | head -n 1)
OUT="dist/bookmark-dashboard-${VERSION}-signed.xpi"
mv "$SIGNED" "$OUT"
echo "Listo. .xpi firmado: $OUT"

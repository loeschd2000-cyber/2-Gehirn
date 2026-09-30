#!/bin/bash
# Baut die Web-App aus web/ und verteilt sie: Repo-Wurzel (GitHub Pages) + Ausgabeordner (PC)
set -e
cd "$(dirname "$0")/.."
V=$(date +%Y%m%d%H%M%S)
OUT="/mnt/user-data/outputs/Zweites Gehirn"
build_to() {   # $1 = Zielordner, $2 = Dateiname der Startseite
  mkdir -p "$1/assets/js"
  rm -f "$1"/assets/js/*.js
  cp web/assets/app.css "$1/assets/app.css"
  cp web/assets/js/*.js "$1/assets/js/"
  [ -d web/assets/img ] && mkdir -p "$1/assets/img" && cp -r web/assets/img/. "$1/assets/img/" || true
  sed "s/__V__/$V/g" web/index.src.html > "$1/$2"
}
build_to . index.html
build_to "$OUT/app" zweites-gehirn-pc.html
build_to "$OUT/online" index.html
build_to "$OUT/github-repo" index.html
echo "gebaut: $V"

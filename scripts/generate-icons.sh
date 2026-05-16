#!/bin/sh
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)/public/icons"
mkdir -p "$DIR"

if command -v magick >/dev/null 2>&1; then
  CMD=magick
elif command -v convert >/dev/null 2>&1; then
  CMD=convert
else
  echo "ImageMagick not found; install with: brew install imagemagick" >&2
  exit 1
fi

$CMD -size 192x192 "xc:#fe3c72" \
  \( -background none -fill white -gravity center -pointsize 96 \
     -font Helvetica-Bold label:'♥' \) -composite \
  "$DIR/icon-192.png"

$CMD "$DIR/icon-192.png" -resize 512x512 "$DIR/icon-512.png"
echo "Icons written to $DIR"

#!/bin/sh
set -e
mkdir -p /app/data/uploads
chown -R node:node /app/data
exec su-exec node node server/index.js

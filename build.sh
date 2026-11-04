#!/bin/sh
# Rebuilds public/app.js from web/ (only needed if you edit the React source; requires esbuild + react installed)
cd "$(dirname "$0")"
NODE_PATH=$(npm root -g) ${ESBUILD:-esbuild} web/main.jsx --bundle --minify --jsx=automatic --target=es2019 --define:process.env.NODE_ENV=\"production\" --outfile=public/app.js

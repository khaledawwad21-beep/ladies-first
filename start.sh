#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d backend/node_modules ]; then
  echo "Installing backend dependencies..."
  (cd backend && npm install --omit=dev)
fi
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
  node -e "const fs=require('fs');const p='backend/.env';let s=fs.readFileSync(p,'utf8').replace(/^JWT_SECRET=.*$/m,'JWT_SECRET='+process.argv[1]);fs.writeFileSync(p,s)" "$SECRET"
fi
echo "Ladies First running at http://localhost:3000"
node backend/src/server.js

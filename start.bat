@echo off
cd /d %~dp0
if not exist backend\node_modules (
  echo Installing backend dependencies...
  cd backend
  call npm install --omit=dev
  if errorlevel 1 exit /b 1
  cd ..
)
if not exist backend\.env (
  copy /Y backend\.env.example backend\.env >nul
  echo Please set a strong JWT_SECRET in backend\.env before production use.
)
echo Ladies First running at http://localhost:3000
node backend\src\server.js

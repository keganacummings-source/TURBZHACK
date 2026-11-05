@echo off
title TURBZHACK Overlord
cd /d "%~dp0"

echo ========================================
echo   TURBZHACK + Overlord
echo ========================================
echo.

REM Build the TypeScript if needed
echo Building...
call npm run build
if errorlevel 1 (
  echo Build failed. Make sure you ran npm install.
  pause
  exit /b 1
)

echo.
echo Starting server with Overlord mode...
echo Open http://localhost:8099
echo Press Ctrl+C to stop.
echo.

node tools/serve.mjs --overlord

pause

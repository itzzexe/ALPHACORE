@echo off
setlocal EnableExtensions
title Crucible Core - Operations Console
cd /d "%~dp0crucible-core"

echo.
echo   ^> CRUCIBLE CORE ^| operations console
echo   -----------------------------------------
echo.

rem --- 1. Check Node.js is installed and version is 22.5+ ---
where node >nul 2>nul
if errorlevel 1 (
    echo   [ERROR] Node.js not found. Install Node 22.5+ from https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -v') do set "NODEMAJOR=%%v"
set "NODEMAJOR=%NODEMAJOR:v=%"
if %NODEMAJOR% LSS 22 (
    echo   [ERROR] Node %NODEMAJOR% detected - Crucible Core needs Node 22.5 or newer.
    echo.
    pause
    exit /b 1
)
echo   [ok] Node.js detected

rem --- 2. Install dependencies on first run ---
if not exist node_modules (
    echo   [..] Installing dependencies - first run only...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo   [ERROR] npm install failed.
        pause
        exit /b 1
    )
)
echo   [ok] Dependencies present

rem --- 3. Seed demo data on first run (mock mode - costs nothing) ---
if not exist data\crucible.db (
    echo   [..] First run - seeding demo agents, runs, and a tribunal case...
    node --experimental-sqlite scripts\seed.js
)
echo   [ok] Database ready

rem --- 4. Open the dashboard once the server is up ---
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:8484"

echo.
echo   Dashboard:  http://localhost:8484
echo   Stop:       press Ctrl+C in this window ^(or just close it^)
echo   Live keys:  copy .env.example to .env, add keys, restart
echo.

rem --- 5. Run the server (this window stays open showing logs) ---
node --experimental-sqlite src\server.js

echo.
echo   Server stopped.
pause

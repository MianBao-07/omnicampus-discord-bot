@echo off
title Omnicampus Discord Bot Runner
cd /d "%~dp0"

echo ========================================================
echo         OMNICAMPUS 24/7 DISCORD BOT LAUNCHER
echo ========================================================
echo.

:: 1. Check for .env file
if not exist ".env" (
    echo [!] .env file not found.
    echo Creating .env from .env.example...
    copy .env.example .env
    echo Please edit .env with your DISCORD_TOKEN and DISCORD_CLIENT_ID, then restart.
    pause
    exit /b
)

:: 2. Check if node_modules exists
if not exist "node_modules\" (
    echo [*] Installing dependencies...
    call npm install
)

:: 3. Check if CDP port 9222 is listening
netstat -ano | findstr 9222 >nul
if %errorlevel% neq 0 (
    echo [!] Remote debugging port 9222 is NOT active.
    echo [*] Searching for Brave or Chrome...

    set "BROWSER_CMD="
    if exist "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" (
        set "BROWSER_CMD=C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
        echo [*] Found Brave Browser.
    ) else if exist "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe" (
        set "BROWSER_CMD=%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"
        echo [*] Found Brave Browser.
    ) else (
        where brave.exe >nul 2>&1
        if %errorlevel% equ 0 (
            set "BROWSER_CMD=brave.exe"
            echo [*] Found Brave Browser in PATH.
        )
    )

    if not defined BROWSER_CMD (
        if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
            set "BROWSER_CMD=C:\Program Files\Google\Chrome\Application\chrome.exe"
            echo [*] Found Google Chrome.
        ) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
            set "BROWSER_CMD=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
            echo [*] Found Google Chrome.
        ) else (
            set "BROWSER_CMD=chrome.exe"
            echo [*] Defaulting to Chrome.
        )
    )

    echo [*] Launching browser with remote debugging on port 9222...
    start "" "%BROWSER_CMD%" --remote-debugging-port=9222 --remote-allow-origins=*
    timeout /t 3 /nobreak >nul
) else (
    echo [OK] Remote debugging session already detected on port 9222.
)

:: 4. Start the bot
echo.
echo [*] Starting Omnicampus Discord Bot...
node src/index.mjs

pause

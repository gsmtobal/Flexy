@echo off
title FLEXY PRO MAX - DESKTOP
echo ==========================================
echo    FLEXY PRO MAX (DESKTOP VERSION)
echo ==========================================
echo.

echo [1/2] Checking dependencies...
if not exist node_modules (
    echo Installing missing modules...
    call npm install
)

:: Check for electron folder
if not exist node_modules\electron (
    echo Installing Electron wrapper...
    call npm install electron
)

echo.
echo [2/2] Launching Application...
echo Please wait, the window will open shortly.
echo ------------------------------------------

:: Run electron which starts the server in background
npx electron .

echo.
echo Application Closed.
pause

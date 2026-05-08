@echo off
color 0E
echo ======================================================
echo    FLEXY PRO - IDOOM AI AUTO-SOLVER ACTIVATOR
echo ======================================================
echo.
echo [1/3] Installing Puppeteer (Headless Browser)...
call npm install puppeteer --save
echo.
echo [2/3] Installing Stealth Plugins...
call npm install puppeteer-extra puppeteer-extra-plugin-stealth --save
echo.
echo [3/3] Installing AI OCR (Tesseract.js)...
call npm install tesseract.js --save
echo.
echo ======================================================
echo    SUCCESS: AI Auto-Solver is now ready!
echo    Please restart your server (node server.js)
echo ======================================================
pause

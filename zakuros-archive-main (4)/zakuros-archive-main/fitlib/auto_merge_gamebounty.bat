@echo off
REM Auto-refresh GameBounty links from the BITO21 backup (additive merge).
REM Safe to run any time: idempotent, and a failed fetch leaves the file untouched.
setlocal
set "PY=C:\Users\Mfree\AppData\Local\Temp\opencode\scr-venv\Scripts\python.exe"
set "WORK=C:\Users\Mfree\OneDrive\Documents\zakuro\zakuros-archive-main (4)\zakuros-archive-main\fitlib"
cd /d "%WORK%"
echo [%date% %time%] running merge >> "%WORK%\data\logs\merge_gamebounty.log"
"%PY%" -X utf8 "merge_gamebounty.py" >> "%WORK%\data\logs\merge_gamebounty.log" 2>&1
echo [%date% %time%] exit=%ERRORLEVEL% >> "%WORK%\data\logs\merge_gamebounty.log"

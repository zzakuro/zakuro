@echo off
REM Thin launcher so the tool can be called as: gse-autopatcher.cmd <command> ...
setlocal
set "HERE=%~dp0"
set "PY="

if exist "%HERE%.venv\Scripts\python.exe" set "PY=%HERE%.venv\Scripts\python.exe"

if not defined PY (
  where py >nul 2>nul
  if not errorlevel 1 set "PY=py -3"
)

if not defined PY (
  where python >nul 2>nul
  if not errorlevel 1 set "PY=python"
)

if not defined PY (
  echo Could not find Python 3 on PATH. Install it from https://www.python.org/downloads/
  exit /b 1
)

pushd "%HERE%"
%PY% -m autopatcher %*
set "RC=%ERRORLEVEL%"
popd
endlocal & exit /b %RC%

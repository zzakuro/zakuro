@echo off
rem Launcher for the auto-commit watcher (runs hidden, logs next to it).
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process node -ArgumentList '%~dp0auto-git-watch.mjs' -WorkingDirectory '%~dp0' -WindowStyle Hidden -RedirectStandardOutput '%~dp0auto-git-watch.log' -RedirectStandardError '%~dp0auto-git-watch.err.log'"
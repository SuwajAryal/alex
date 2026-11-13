@echo off
node "%~dp0server.mjs" --open
if errorlevel 1 (
    echo Alex could not start. Check the message above.
    pause
)

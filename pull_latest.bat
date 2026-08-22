@echo off
setlocal EnableExtensions

cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git was not found in PATH.
    echo Install Git for Windows or add git.exe to PATH.
    goto :fail
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [ERROR] This BAT file is not inside a Git repository.
    goto :fail
)

for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%B"

if "%BRANCH%"=="HEAD" (
    echo [ERROR] The repository is currently in detached HEAD state.
    echo Switch to a normal branch before running this file.
    goto :fail
)

echo ========================================
echo Updating repository
echo Branch: %BRANCH%
echo ========================================
echo.

echo [1/2] Fetching latest changes...
git fetch --prune origin
if errorlevel 1 goto :fail

echo.
echo [2/2] Pulling latest version...
git pull --ff-only origin "%BRANCH%"
if errorlevel 1 (
    echo.
    echo [ERROR] The pull could not be completed safely.
    echo Check for local changes or branch history differences.
    echo.
    git status --short
    goto :fail
)

echo.
echo ========================================
echo Latest version is ready.
echo ========================================
git log -1 --oneline
echo.
pause
exit /b 0

:fail
echo.
echo Update failed. No forced reset was performed.
echo Resolve the Git issue and run this file again.
echo.
pause
exit /b 1

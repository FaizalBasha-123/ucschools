@echo off
REM Graphify Setup Verification Script for UC School
REM This script verifies that all graphify components are installed correctly

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║          GRAPHIFY SETUP VERIFICATION FOR UC SCHOOL             ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.

set "ERRORS=0"
set "CHECKS=0"

echo Checking installation...
echo.

REM Check graphify.cmd
set /A CHECKS=!CHECKS!+1
if exist graphify.cmd (
    echo [✓] graphify.cmd found
) else (
    echo [✗] graphify.cmd NOT FOUND
    set /A ERRORS=!ERRORS!+1
)

REM Check graphify-uc-school.cmd
set /A CHECKS=!CHECKS!+1
if exist graphify-uc-school.cmd (
    echo [✓] graphify-uc-school.cmd found
) else (
    echo [✗] graphify-uc-school.cmd NOT FOUND
    set /A ERRORS=!ERRORS!+1
)

REM Check init-graphify.ps1
set /A CHECKS=!CHECKS!+1
if exist init-graphify.ps1 (
    echo [✓] init-graphify.ps1 found
) else (
    echo [✗] init-graphify.ps1 NOT FOUND
    set /A ERRORS=!ERRORS!+1
)

REM Check scripts/graphify.ps1
set /A CHECKS=!CHECKS!+1
if exist scripts\graphify.ps1 (
    echo [✓] scripts/graphify.ps1 found
) else (
    echo [✗] scripts/graphify.ps1 NOT FOUND
    set /A ERRORS=!ERRORS!+1
)

REM Check .graphify-context directory
set /A CHECKS=!CHECKS!+1
if exist .graphify-context (
    echo [✓] .graphify-context directory found
) else (
    echo [✗] .graphify-context directory NOT FOUND
    set /A ERRORS=!ERRORS!+1
)

REM Check metadata files
set /A CHECKS=!CHECKS!+1
if exist .graphify-context\project-context.txt (
    echo [✓] project-context.txt found
) else (
    echo [✗] project-context.txt NOT FOUND
    set /A ERRORS=!ERRORS!+1
)

REM Check Claude settings
set /A CHECKS=!CHECKS!+1
if exist .claude\settings.json (
    echo [✓] .claude/settings.json found
) else (
    echo [✗] .claude/settings.json NOT FOUND
    set /A ERRORS=!ERRORS!+1
)

REM Check memory files
set /A CHECKS=!CHECKS!+1
if exist .claude\memory\01-graphify-system.md (
    echo [✓] .claude/memory/01-graphify-system.md found
) else (
    echo [✗] .claude/memory/01-graphify-system.md NOT FOUND
    set /A ERRORS=!ERRORS!+1
)

REM Check documentation
set /A CHECKS=!CHECKS!+1
if exist QUICK_START.md (
    echo [✓] QUICK_START.md found
) else (
    echo [✗] QUICK_START.md NOT FOUND
    set /A ERRORS=!ERRORS!+1
)

REM Check CLAUDE.md
set /A CHECKS=!CHECKS!+1
if exist CLAUDE.md (
    echo [✓] CLAUDE.md found
) else (
    echo [✗] CLAUDE.md NOT FOUND
    set /A ERRORS=!ERRORS!+1
)

echo.
echo Results:
echo ────────────────────────────────────────────────────────────────
echo Total Checks: %CHECKS%
echo Passed:       %CHECKS:~-1%
echo Failed:       %ERRORS%

if %ERRORS% EQU 0 (
    echo.
    echo [✓] All checks passed! Graphify is ready to use.
    echo.
    echo Next step:
    echo   .\graphify-uc-school.cmd init
    echo.
    exit /b 0
) else (
    echo.
    echo [✗] Some checks failed. Run init-graphify.ps1 to complete setup.
    echo.
    echo Fix with:
    echo   pwsh -NoProfile -ExecutionPolicy Bypass -File "init-graphify.ps1"
    echo.
    exit /b 1
)

@echo off
REM Quick wrapper for graphify operations on UC School project
REM Usage: graphify-uc-school.cmd [context|tree|md|init|refresh]

setlocal
cd /d "%~dp0"

set GRAPHIFY_CMD=%~dp0graphify.cmd

if "%1"=="" (
    echo Graphify UC School - Quick Commands
    echo.
    echo Usage: graphify-uc-school.cmd [command]
    echo.
    echo Commands:
    echo   init     - Initialize graphify (run once^)
    echo   refresh  - Refresh all metadata
    echo   context  - Show project context
    echo   tree     - Show project tree
    echo   md       - List markdown files
    echo   help     - Show this help
    echo.
    goto :eof
)

if "%1"=="init" (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "init-graphify.ps1"
    goto :eof
)

if "%1"=="refresh" (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "init-graphify.ps1"
    goto :eof
)

if "%1"=="context" (
    call "%GRAPHIFY_CMD%" context -Root . -Scope external -Limit 200
    goto :eof
)

if "%1"=="tree" (
    call "%GRAPHIFY_CMD%" tree -Root . -Scope external
    goto :eof
)

if "%1"=="md" (
    call "%GRAPHIFY_CMD%" md -Root . -Scope external -Limit 500
    goto :eof
)

if "%1"=="help" (
    echo Graphify UC School - Help
    echo.
    echo One-Command Bootstrap:
    echo   graphify-uc-school.cmd init
    echo.
    echo Usage with Claude:
    echo   1. Run: graphify-uc-school.cmd init
    echo   2. Claude will automatically use graphify context
    echo   3. Update with: graphify-uc-school.cmd refresh
    echo.
    goto :eof
)

echo Unknown command: %1
echo Run 'graphify-uc-school.cmd help' for usage
endlocal

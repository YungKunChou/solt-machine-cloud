@echo off
chcp 65001 >nul
setlocal
title 雲端雙滾輪 - 本機啟動
pushd "%~dp0"
if errorlevel 1 goto failed
where node.exe >nul 2>&1
if errorlevel 1 (
    echo 找不到 Node.js。請先安裝 Node.js，再重新雙擊此檔案。
    echo https://nodejs.org/
    goto failed
)
node "scripts\start-local.cjs"
if errorlevel 1 goto failed
popd
exit /b 0

:failed
echo.
echo 啟動未完成。請查看上方訊息。
pause
exit /b 1

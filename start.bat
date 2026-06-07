@echo off
setlocal enabledelayedexpansion
node -v >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js
    echo 请先安装 Node.js（推荐 LTS 版本）
    echo 下载地址: https://nodejs.org
) else (
    cd /d %~dp0
    if not exist node_modules (
        echo [1/2] 安装依赖中...
        call npm install
        echo [OK] 依赖安装完成
        echo.
    )
    if not exist packages\cli\dist\index.js (
        echo [1/1] 编译项目中...
        call npm run build
        echo [OK] 编译完成
        echo.
    )
    node packages\cli\dist\index.js
)
pause

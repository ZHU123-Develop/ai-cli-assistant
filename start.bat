@echo off
chcp 65001 >nul
title AI CLI Assistant 一键启动
echo ========================================
echo   AI CLI Assistant 一键启动工具
echo ========================================
echo.

:: 检测 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js
    echo.
    echo 请先安装 Node.js（推荐 LTS 版本）
    echo 下载地址: https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo [OK] Node.js: %NODE_VERSION%
echo.

:: 检测 npm
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 npm
    pause
    exit /b 1
)
echo [OK] npm 已安装
echo.

:: 项目目录 = 脚本所在目录
set PROJECT_DIR=%~dp0

:: 检查是否已安装依赖
if not exist "%PROJECT_DIR%node_modules" (
    echo [1/3] 安装依赖中...
    cd /d "%PROJECT_DIR%"
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
    echo [OK] 依赖安装完成
    echo.
) else (
    echo [OK] 依赖已安装
    echo.
)

:: 检查是否已编译
if not exist "%PROJECT_DIR%packages\cli\dist\index.js" (
    echo [2/3] 编译项目中...
    cd /d "%PROJECT_DIR%"
    call npm run build
    if %errorlevel% neq 0 (
        echo.
        echo [错误] 编译失败
        pause
        exit /b 1
    )
    echo [OK] 编译完成
    echo.
) else (
    echo [OK] 项目已编译
    echo.
)

:: 全局注册命令
echo [3/3] 注册全局命令...
cd /d "%PROJECT_DIR%packages\cli"
call npm link >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] 全局命令已注册: ai-cli
) else (
    echo [!] 全局命令注册失败（可能需要管理员权限）
)
echo.

:: 启动
echo ========================================
echo   启动 AI CLI Assistant
echo ========================================
echo.
node dist\index.js

pause

@echo off
REM 自动化插件 · 界面版 v1.3.0 启动脚本（Windows 双击运行）
REM 要求：已安装 Node.js v20.19 或更高（命令行输入 node --version 能打出版本号）。
REM 启动后自动打开浏览器到本机地址；关闭这个窗口即停止服务。
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo 请先安装 Node.js（v20.19 或更高），再双击本文件。
  echo 下载地址见 docs\ui-guide.md。
  pause
  exit /b 1
)
set PORT=18771
start "automation-ui" /min node bin\server.mjs
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:18771/"
echo 界面已启动：http://127.0.0.1:18771/
echo 关闭名为 automation-ui 的窗口即停止服务。
pause

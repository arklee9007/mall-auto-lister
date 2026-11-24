#!/bin/sh
# 自动化插件 · 界面版 v1.3.0 启动脚本（macOS / Linux）
# 要求：已安装 Node.js v20.19 或更高（命令行输入 node --version 能打出版本号）。
# 启动后自动打开浏览器到本机地址；按 Ctrl+C 停止服务。
# 用法：sh start-ui.sh（或先 chmod +x start-ui.sh 再 ./start-ui.sh）
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "请先安装 Node.js（v20.19 或更高），再运行本脚本。"; exit 1; }
PORT="${PORT:-18771}"
node bin/server.mjs --port "$PORT" &
SERVER_PID=$!
sleep 2
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://127.0.0.1:$PORT/" >/dev/null 2>&1
elif command -v open >/dev/null 2>&1; then
  open "http://127.0.0.1:$PORT/" >/dev/null 2>&1
else
  echo "请打开浏览器访问 http://127.0.0.1:$PORT/"
fi
echo "界面已启动：http://127.0.0.1:$PORT/（按 Ctrl+C 停止）"
wait $SERVER_PID

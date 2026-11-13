#!/usr/bin/env bash
# 停止 Mermaid Studio 静态服务
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${MS_PORT:-5273}"
PID_FILE="$DIR/.run/server-$PORT.pid"

stopped=0
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null && stopped=1 && echo "· 已停止（PID ${PID}）"
  fi
  rm -f "$PID_FILE"
fi

# 兜底：按端口找残留进程
PIDS="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$PIDS" ]; then
  for pid in $PIDS; do
    kill "$pid" 2>/dev/null && stopped=1 && echo "· 已停止占用端口 $PORT 的进程（PID ${pid}）"
  done
fi

[ "$stopped" = "1" ] || echo "· 没有在运行的服务"

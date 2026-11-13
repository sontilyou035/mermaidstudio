#!/usr/bin/env bash
# 改完代码后一键更新：类型检查 → 回归测试 → 构建 → 重启服务
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
PORT="${MS_PORT:-5273}"
DEV_PORT="${MS_DEV_PORT:-5274}"

echo "· 1/4 类型检查"
npm run typecheck

if [ "${SKIP_E2E:-0}" != "1" ]; then
  echo "· 2/4 端到端回归（需要 dev server 在 $DEV_PORT 上；跳过请用 SKIP_E2E=1）"
  if curl -sf -o /dev/null "http://127.0.0.1:$DEV_PORT/"; then
    MS_BASE="http://127.0.0.1:$DEV_PORT" bash scripts/run-e2e.sh || echo "⚠ 有测试未通过，先检查再继续"
  else
    echo "  （dev server 没跑，跳过回归）"
  fi
else
  echo "· 2/4 已跳过回归"
fi

echo "· 3/4 构建"
npm run build

echo "· 4/4 重启服务"
bash scripts/stop.sh >/dev/null 2>&1 || true
bash scripts/start.sh

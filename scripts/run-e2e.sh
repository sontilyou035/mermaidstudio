#!/usr/bin/env bash
# 端到端验证：需要静态服务或 dev server 已运行（默认 127.0.0.1:5274，可用 MS_BASE 覆盖），并用带调试端口的 Chrome 打开页面。
#
# 用法：
#   1) npm run dev                       # 另开一个终端
#   2) bash scripts/run-e2e.sh           # 自动拉起 headless Chrome 并跑全部组验证
set -u
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=9333
BASE="${MS_BASE:-http://127.0.0.1:5274}"

if ! curl -sf -o /dev/null "$BASE/"; then
  echo "✗ dev server 没有运行（${BASE}），请先执行: npm run dev"
  exit 1
fi

if ! curl -sf -o /dev/null "http://127.0.0.1:${PORT}/json/version"; then
  echo "· 启动 headless Chrome (调试端口 ${PORT})"
  rm -rf /tmp/chrome-ms-e2e
  "$CHROME" --headless=new --no-sandbox --disable-gpu --in-process-gpu --no-first-run \
    --user-data-dir=/tmp/chrome-ms-e2e --remote-debugging-port=${PORT} \
    --window-size=1560,940 about:blank >/tmp/chrome-ms-e2e.log 2>&1 &
  sleep 3
fi

fail=0
for f in scripts/e2e-1-core.mjs scripts/e2e-2-layout.mjs scripts/e2e-3-behavior.mjs scripts/e2e-4-features.mjs scripts/e2e-5-fixes.mjs scripts/e2e-6-edges.mjs scripts/e2e-7-alt-drag.mjs scripts/e2e-8-docs.mjs scripts/e2e-9-blocks.mjs scripts/e2e-10-node-ids.mjs scripts/e2e-11-edge-labels.mjs scripts/e2e-12-backup.mjs scripts/e2e-13-render-engine.mjs scripts/e2e-14-skin.mjs scripts/e2e-15-node-style.mjs scripts/e2e-16-card-cursor.mjs scripts/e2e-17-timeline.mjs scripts/e2e-18-ports.mjs scripts/e2e-19-groups.mjs scripts/e2e-20-complex.mjs; do
  echo "──────── $f"
  MS_BASE="$BASE" node "$f" || fail=1
done

if [ "$fail" = "0" ]; then echo "✓ 全部通过"; else echo "✗ 有失败项"; fi
exit $fail

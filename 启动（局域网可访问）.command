#!/usr/bin/env bash
# 局域网访问现在已是默认：这个入口保留下来，避免旧的收藏/习惯失效。
# 双击「启动 Mermaid Studio.command」效果完全一样。
cd "$(dirname "$0")"
bash scripts/stop.sh >/dev/null 2>&1 || true
MS_HOST=0.0.0.0 bash scripts/start.sh
echo ""
echo "提示：同网段设备用上面「局域网访问」那个地址打开。"
echo "      每台设备的图表各自存在各自浏览器里，互不可见。"
echo "      只想本机访问：MS_HOST=127.0.0.1 bash scripts/start.sh"
echo "按回车关闭此窗口…"
read -r _

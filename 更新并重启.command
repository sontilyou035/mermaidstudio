#!/usr/bin/env bash
cd "$(dirname "$0")"
bash scripts/deploy.sh
echo ""
echo "按回车关闭此窗口…"
read -r _

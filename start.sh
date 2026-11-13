#!/usr/bin/env bash
# 兼容入口：真正的启动逻辑在 scripts/start.sh（避免两份脚本行为漂移）。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$DIR/scripts/start.sh" "$@"

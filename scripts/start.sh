#!/usr/bin/env bash
# 启动 Mermaid Studio（构建产物 + 本地静态服务）
# 双击「启动 Mermaid Studio.command」等价于执行这个脚本。
# 默认绑 0.0.0.0：同网段设备也能打开；只给本机用 MS_HOST=127.0.0.1。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
# MS_NO_OPEN=1 时不自动打开浏览器（自动化验证用）
open_url() { [ "${MS_NO_OPEN:-0}" = "1" ] || open "$1" >/dev/null 2>&1 || true; }
PORT="${MS_PORT:-5273}"
HOST="${MS_HOST:-0.0.0.0}"
RUN_DIR="$DIR/.run"
PID_FILE="$RUN_DIR/server-$PORT.pid"
LOG_FILE="$RUN_DIR/server-$PORT.log"
# 浏览器/健康检查一律走回环地址：既能在绑 0.0.0.0 时用，也保住 127.0.0.1 这个 origin 的本地数据
LOCAL_URL="http://127.0.0.1:$PORT/"
mkdir -p "$RUN_DIR"

# 非回环 IPv4（局域网地址），跳过 utun/awdl 等代理与虚拟网卡；没有就输出空
lan_ips() {
  node -e 'const os=require("os"),skip=/^(utun|awdl|llw|bridge|gif|stf|anpi|ap\d|vmenet)/i,out=[];for(const[n,l]of Object.entries(os.networkInterfaces())){if(skip.test(n))continue;for(const i of l||[])if(i.family==="IPv4"&&!i.internal)out.push(i.address)}console.log(out.join(" "))' 2>/dev/null || true
}

# 已经在跑就直接打开浏览器
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "· 服务已经在运行（PID $(cat "$PID_FILE")）"
  open_url "$LOCAL_URL"
  exit 0
fi

# 没有构建产物就先构建
if [ ! -f "$DIR/dist/index.html" ]; then
  echo "· 首次启动，正在构建（约 10 秒）…"
  npm run build
fi

echo "· 启动服务 $LOCAL_URL（绑定 $HOST:$PORT）"
# 脱离当前终端：关掉窗口、退出 shell 都不影响服务
nohup node "$DIR/scripts/serve.mjs" --port "$PORT" --host "$HOST" < /dev/null >"$LOG_FILE" 2>&1 &
SRV_PID=$!
disown "$SRV_PID" 2>/dev/null || true
echo "$SRV_PID" > "$PID_FILE"

# 等端口就绪
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "$LOCAL_URL"; then break; fi
  sleep 0.3
done

if ! curl -sf -o /dev/null "$LOCAL_URL"; then
  echo "✗ 服务没起来，看看日志：$LOG_FILE"
  exit 1
fi

echo "✓ 已就绪：$LOCAL_URL"
case "$HOST" in
  0.0.0.0|::|"")
    IPS="$(lan_ips)"
    if [ -n "$IPS" ]; then
      for ip in $IPS; do echo "· 局域网访问：http://$ip:$PORT/"; done
    else
      echo "· 没检测到局域网 IPv4 地址（可能没连 Wi-Fi/网线）"
    fi
    echo "· 只给本机用：MS_HOST=127.0.0.1 bash scripts/start.sh"
    ;;
  *)
    echo "· 只绑定了 $HOST（同网段其他设备访问不到）"
    ;;
esac
open_url "$LOCAL_URL"
echo "· 关闭这个窗口不影响服务；要停止请双击「停止 Mermaid Studio.command」"

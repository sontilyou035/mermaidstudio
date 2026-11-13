#!/usr/bin/env node
/**
 * Mermaid Studio 本地静态服务（零依赖）。
 * 用法：node scripts/serve.mjs [--port 5273] [--host 0.0.0.0] [--dir dist]
 *
 * 默认绑 0.0.0.0（同网段设备可直接访问）；只给本机用传 --host 127.0.0.1。
 *
 * 为什么要它：构建产物是 ES module + 用到「另存为」文件 API，
 * 必须跑在 http（安全上下文）下，双击 index.html（file://）是打不开的。
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const PORT = Number(arg('port', process.env.MS_PORT || 5273))
const HOST = arg('host', process.env.MS_HOST || '0.0.0.0')
const DIST = resolve(ROOT, arg('dir', 'dist'))
const LAN = HOST === '0.0.0.0' || HOST === '::' || HOST === ''

/** 非回环 IPv4，用来提示局域网地址（跳过 utun/awdl 等代理与虚拟网卡） */
function lanAddresses() {
  const SKIP = /^(utun|awdl|llw|bridge|gif|stf|anpi|ap\d|vmenet)/i
  const out = []
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (SKIP.test(name)) continue
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address)
    }
  }
  return out
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mmd': 'text/plain; charset=utf-8',
}

if (!existsSync(DIST) || !existsSync(join(DIST, 'index.html'))) {
  console.error(`✗ 找不到构建产物：${DIST}`)
  console.error('  先执行：npm run build')
  process.exit(1)
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers })
  res.end(body)
}

const server = createServer((req, res) => {
  try {
    // 用固定 base 解析请求路径：HOST 为 0.0.0.0/:: 时不能直接拼进 URL
    const url = new URL(req.url ?? '/', 'http://localhost')
    let pathname = decodeURIComponent(url.pathname)
    if (pathname.endsWith('/')) pathname += 'index.html'

    // 防目录穿越：解析后必须仍在 dist 里
    let filePath = normalize(join(DIST, pathname))
    if (!filePath.startsWith(DIST + sep) && filePath !== DIST) {
      send(res, 403, 'Forbidden')
      return
    }

    // 单页应用：找不到文件就回退到 index.html
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      const fallback = join(DIST, pathname === '/' ? 'index.html' : 'index.html')
      if (existsSync(fallback)) {
        filePath = fallback
      } else {
        send(res, 404, 'Not Found')
        return
      }
    }

    const ext = extname(filePath).toLowerCase()
    const isHtml = ext === '.html'
    const stat = statSync(filePath)
    const headers = {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      // 文件名带 hash 的资源可以长缓存，index.html 必须每次校验
      'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=31536000, immutable',
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, headers)
      res.end()
      return
    }
    res.writeHead(200, headers)
    createReadStream(filePath).pipe(res)
  } catch (err) {
    send(res, 500, `Server error: ${err.message}`)
  }
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`✗ 端口 ${PORT} 已被占用。`)
    console.error(`  可能是开发服务器（npm run dev）或上一次的静态服务还在跑。`)
    console.error(`  换个端口：node scripts/serve.mjs --port 5274`)
    console.error(`  或者先停掉：bash scripts/stop.sh`)
  } else {
    console.error('✗ 启动失败：', err.message)
  }
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log('')
  console.log('  Mermaid Studio 已启动')
  console.log(`  ➜  本机：http://127.0.0.1:${PORT}/`)
  if (LAN) {
    const ips = lanAddresses()
    if (ips.length) {
      for (const ip of ips) console.log(`  ➜  局域网：http://${ip}:${PORT}/`)
    } else {
      console.log('  · 没检测到局域网 IPv4 地址（可能没连 Wi-Fi/网线）')
    }
    console.log(`  绑定：${HOST}:${PORT}（同网段设备可访问；只给本机用：--host 127.0.0.1）`)
  }
  console.log(`  目录：${DIST}`)
  console.log('  停止：在这个窗口按 Ctrl+C，或双击「停止 Mermaid Studio.command」')
  console.log('')
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n· 已停止服务')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500)
  })
}

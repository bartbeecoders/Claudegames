/* Zero-dependency static server, for when you'd rather not run from file://.
   Usage: node server.mjs [port] */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname)
const PORT = Number(process.argv[2]) || 8080

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
}

async function isDirectory (p) {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  const path = join(ROOT, rel === '/' || rel === '\\' ? 'index.html' : rel)

  // Never serve anything outside the project directory.
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden')
    return
  }

  try {
    // This site is a directory per game, so `/gauntlet/` has to resolve to that
    // folder's index.html the way a real static host would.
    const target = (await isDirectory(path)) ? join(path, 'index.html') : path
    const body = await readFile(target)
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    }).end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
  }
}).listen(PORT, () => {
  console.log(`\n  CLAUDE GAMES\n`)
  console.log(`  local    http://localhost:${PORT}`)
  // Print LAN addresses so you can open the game on a phone on the same Wi-Fi.
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  network  http://${a.address}:${PORT}`)
    }
  }
  console.log('')
})

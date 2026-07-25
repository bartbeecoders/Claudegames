/* Bundle the game into one self-contained HTML file.

   Every script is inlined, the CSS is already inline, and the favicon is a
   data URI — so the output has zero external references. That makes it
   droppable on any static host, openable straight from disk, and (unlike the
   multi-file version) playable from the iOS Files app.

   Usage: node build.mjs */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname)
const OUT_DIR = join(ROOT, 'dist')
const OUT = join(OUT_DIR, 'gauntlet.html')

const SCRIPT_TAG = /^([ \t]*)<script src="([^"]+)"><\/script>[ \t]*$/gm

const html = await readFile(join(ROOT, 'index.html'), 'utf8')

const inlined = []
let bundled = html.replace(SCRIPT_TAG, (_match, indent, src) => {
  inlined.push(src)
  return `${indent}<script data-src="${src}">\n__INLINE__${src}\n${indent}</script>`
})

for (const src of inlined) {
  const code = await readFile(join(ROOT, src), 'utf8')
  // A literal </script> inside a string would close the tag early. None of the
  // sources contain one, but guard anyway so this can't silently break.
  if (/<\/script/i.test(code)) throw new Error(`${src} contains a </script> sequence`)
  bundled = bundled.replace(`__INLINE__${src}`, code.trimEnd())
}

if (bundled.includes('__INLINE__')) throw new Error('an inline placeholder was left unresolved')
if (/<script src=/.test(bundled)) throw new Error('an external script reference survived bundling')

await mkdir(OUT_DIR, { recursive: true })
await writeFile(OUT, bundled)

const kb = (Buffer.byteLength(bundled) / 1024).toFixed(1)
console.log(`\n  dist/gauntlet.html  ${kb} kB  (${inlined.length} scripts inlined, no external refs)\n`)

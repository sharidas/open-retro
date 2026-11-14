import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const seen = new Map()
const errors = []
async function walk(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue
    const path = join(folder, entry.name)
    const name = relative(root, path).replaceAll('\\', '/')
    if (/[<>:"|?*]|[. ]$/.test(entry.name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(entry.name)) errors.push(`Windows-incompatible path: ${name}`)
    // Ignore JS/TS extensions when comparing: extensionless imports can resolve
    // a differently-cased .ts before the intended .tsx on macOS and Windows.
    const key = name.replace(/\.(?:[cm]?[jt]sx?)$/, '').toLowerCase()
    if (seen.has(key)) errors.push(`Ambiguous paths: ${seen.get(key)} and ${name}`)
    else seen.set(key, name)
    if (entry.isDirectory()) await walk(path)
  }
}
await walk(join(root, 'apps'))
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
else console.log('Portable source filenames verified.')

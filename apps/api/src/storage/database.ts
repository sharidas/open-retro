import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function openDatabase(path: string) {
  await mkdir(dirname(path), { recursive: true })
  const client = createClient({ url: pathToFileURL(path).href })
  try {
    await client.execute('PRAGMA foreign_keys = ON')
    await client.execute('PRAGMA busy_timeout = 5000')
    await client.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY NOT NULL
    )`)
    const folder = new URL('../../migrations/', import.meta.url)
    const files = (await readdir(folder)).filter((name) => name.endsWith('.sql')).sort()
    for (const name of files) {
      const tx = await client.transaction('write')
      try {
        const applied = await tx.execute({ sql: 'SELECT name FROM schema_migrations WHERE name = ?', args: [name] })
        if (applied.rows.length === 0) {
          await tx.executeMultiple(await readFile(new URL(name, folder), 'utf8'))
          await tx.execute({ sql: 'INSERT INTO schema_migrations (name) VALUES (?)', args: [name] })
        }
        await tx.commit()
      } catch (error) {
        await tx.rollback()
        throw error
      } finally {
        tx.close()
      }
    }
    return { db: drizzle(client), close: () => client.close() }
  } catch (error) {
    client.close()
    throw error
  }
}

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

let db: SqlJsDatabase | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_MS = 300

function dbPath(): string {
  return path.join(app.getPath('userData'), 'ambicrew.sqlite')
}

export async function openDatabase(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs()
  const filePath = dbPath()
  if (fs.existsSync(filePath)) {
    const buffer = fs.readFileSync(filePath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }
  db.run(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)`)
  return db
}

export function getDb(): SqlJsDatabase {
  if (!db) throw new Error('Database not opened')
  return db
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => flushSave(), DEBOUNCE_MS)
}

export function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  if (!db) return
  const data = db.export()
  const buffer = Buffer.from(data)
  const dir = path.dirname(dbPath())
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(dbPath(), buffer)
}

export function kvGet(key: string): string | null {
  const row = getDb().exec('SELECT value FROM kv WHERE key = ?', [key])
  if (row.length > 0 && row[0]!.values.length > 0) {
    return row[0]!.values[0]![0] as string | null
  }
  return null
}

export function kvSet(key: string, value: string): void {
  getDb().run('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, value])
  scheduleSave()
}

export function kvDelete(key: string): void {
  getDb().run('DELETE FROM kv WHERE key = ?', [key])
  scheduleSave()
}

export function closeDatabase() {
  flushSave()
  if (db) { db.close(); db = null }
}

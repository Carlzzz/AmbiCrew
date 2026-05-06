import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

export type SkillSource = 'user' | 'claude' | 'bundled'

export interface SkillRoot {
  kind: SkillSource
  path: string
}

export function getSkillRoots(): SkillRoot[] {
  const roots: SkillRoot[] = []

  // 1. User root (writable, primary) — {userData}/SKILLs
  roots.push({
    kind: 'user',
    path: path.join(app.getPath('userData'), 'SKILLs'),
  })

  // 2. Claude shared root — ~/.claude/skills (if exists)
  const claudeSkills = path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'skills')
  if (fs.existsSync(claudeSkills)) {
    roots.push({ kind: 'claude', path: claudeSkills })
  }

  // 3. Bundled root
  if (app.isPackaged) {
    roots.push({
      kind: 'bundled',
      path: path.join(process.resourcesPath, 'SKILLs'),
    })
  } else {
    roots.push({
      kind: 'bundled',
      path: path.join(app.getAppPath(), '..', 'SKILLs'),
    })
  }

  return roots
}

export function syncBundledSkillsToUserData(): void {
  const roots = getSkillRoots()
  const bundledRoot = roots.find((r) => r.kind === 'bundled')
  const userRoot = roots.find((r) => r.kind === 'user')
  if (!bundledRoot || !userRoot || !fs.existsSync(bundledRoot.path)) return

  if (!fs.existsSync(userRoot.path)) {
    fs.mkdirSync(userRoot.path, { recursive: true })
  }

  const entries = fs.readdirSync(bundledRoot.path, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dest = path.join(userRoot.path, entry.name)
    if (fs.existsSync(dest)) continue
    copyDirSync(path.join(bundledRoot.path, entry.name), dest)
  }
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

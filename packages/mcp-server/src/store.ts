import { mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve, relative, basename } from 'node:path'

export const RAW_DIR = join('data', 'raw', 'x-analytics')
export const REPORTS_DIR = join('data', 'reports')

function assertInside(root: string, target: string): string {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  const rel = relative(resolvedRoot, resolvedTarget)
  if (rel.startsWith('..') || rel === '') {
    throw new Error('path escapes NexAuto data directory')
  }
  return resolvedTarget
}

export function rawDir(root: string): string {
  return join(root, RAW_DIR)
}

export function reportsDir(root: string): string {
  return join(root, REPORTS_DIR)
}

export function archiveCsv(root: string, sourcePath: string): string {
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    throw new Error(`CSV が見つかりません: ${basename(sourcePath)}`)
  }
  const day = new Date().toISOString().slice(0, 10)
  const destDir = join(rawDir(root), day)
  mkdirSync(destDir, { recursive: true })
  const dest = join(destDir, basename(sourcePath))
  copyFileSync(sourcePath, dest)
  return dest
}

export function listRawExports(root: string): string[] {
  const base = rawDir(root)
  if (!existsSync(base)) return []
  const out: string[] = []
  for (const day of readdirSync(base).sort().reverse()) {
    const dir = join(base, day)
    if (!statSync(dir).isDirectory()) continue
    for (const name of readdirSync(dir).sort()) {
      if (name.endsWith('.csv')) out.push(join(RAW_DIR, day, name))
    }
  }
  return out
}

const REPORT_REL = /^(x|threads)\/[a-z0-9-]+\/[A-Za-z0-9._-]+\.md$/

export function reportPath(root: string, relativePath: string): string {
  const normalized = relativePath.replace(/^\/+/, '')
  if (!REPORT_REL.test(normalized)) {
    throw new Error('レポートパスは x/<account-slug>/<file>.md または threads/<account-slug>/<file>.md 形式だけを受け付ける')
  }
  return assertInside(reportsDir(root), join(reportsDir(root), normalized))
}

export function saveMarkdownReport(root: string, relativePath: string, content: string): string {
  const dest = reportPath(root, relativePath)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, content, 'utf8')
  return join(REPORTS_DIR, relativePath.replace(/^\/+/, ''))
}

export function readMarkdownReport(root: string, relativePath: string): string {
  const dest = reportPath(root, relativePath)
  if (!existsSync(dest)) throw new Error(`レポートがありません: ${relativePath}`)
  return readFileSync(dest, 'utf8')
}

export function listMarkdownReports(root: string): string[] {
  const base = reportsDir(root)
  if (!existsSync(base)) return []
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.md')) out.push(relative(base, full))
    }
  }
  walk(base)
  return out.sort()
}

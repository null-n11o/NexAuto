import type { StrategyExample } from '../../../../src/types'

export interface ApplyArgs {
  accountQuery: string
  examplesPath: string
  sourceReportId: string | undefined
}

export function parseApplyArgs(argv: string[]): ApplyArgs {
  const positional: string[] = []
  let sourceReportId: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source-report') {
      sourceReportId = argv[i + 1]
      i++
    } else {
      positional.push(argv[i])
    }
  }
  if (positional.length < 1) throw new Error('アカウント名を指定してください')
  if (positional.length < 2) throw new Error('examples JSONのパスを指定してください')
  return { accountQuery: positional[0], examplesPath: positional[1], sourceReportId }
}

export function nextVersion(currentMax: number | null): number {
  return currentMax == null ? 1 : currentMax + 1
}

export function validateExamples(data: unknown): StrategyExample[] {
  if (!Array.isArray(data)) throw new Error('examples は配列である必要があります')
  if (data.length === 0) throw new Error('examples が空です')
  data.forEach((e, i) => {
    const prefix = `examples[${i}]`
    if (typeof e?.format !== 'string' || e.format.length === 0) throw new Error(`${prefix}.format が不正です`)
    if (typeof e?.title !== 'string') throw new Error(`${prefix}.title が不正です`)
    if (typeof e?.content !== 'string' || e.content.length === 0) throw new Error(`${prefix}.content が不正です`)
    if (typeof e?.score !== 'number') throw new Error(`${prefix}.score が不正です`)
    if (typeof e?.rationale !== 'string') throw new Error(`${prefix}.rationale が不正です`)
    const m = e?.metrics
    if (typeof m?.impressions !== 'number' || typeof m?.likes !== 'number') {
      throw new Error(`${prefix}.metrics には impressions と likes が必要です`)
    }
  })
  return data as StrategyExample[]
}

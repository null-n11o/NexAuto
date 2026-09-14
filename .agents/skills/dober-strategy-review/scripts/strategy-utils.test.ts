import { describe, it, expect } from 'vitest'
import { parseApplyArgs, validateExamples, nextVersion } from './strategy-utils'
import type { StrategyExample } from '../../../../src/types'

const validExample: StrategyExample = {
  format: 'A',
  title: '▫️見出し',
  content: '本文',
  metrics: { impressions: 100, likes: 10 },
  score: 123.4,
  rationale: '理由',
}

describe('parseApplyArgs', () => {
  it('アカウント名とexamplesパスを解釈する', () => {
    expect(parseApplyArgs(['Dober', 'examples.json'])).toEqual({
      accountQuery: 'Dober',
      examplesPath: 'examples.json',
      sourceReportId: undefined,
    })
  })

  it('--source-report でレポートIDを受け取る', () => {
    expect(parseApplyArgs(['Dober', 'examples.json', '--source-report', 'rep-1'])).toEqual({
      accountQuery: 'Dober',
      examplesPath: 'examples.json',
      sourceReportId: 'rep-1',
    })
  })

  it('アカウント名が無い場合はエラー', () => {
    expect(() => parseApplyArgs([])).toThrow('アカウント名を指定してください')
  })

  it('examplesパスが無い場合はエラー', () => {
    expect(() => parseApplyArgs(['Dober'])).toThrow('examples JSONのパスを指定してください')
  })
})

describe('nextVersion', () => {
  it('既存が無ければ1を返す', () => {
    expect(nextVersion(null)).toBe(1)
  })
  it('既存の最大versionに1を足す', () => {
    expect(nextVersion(3)).toBe(4)
  })
})

describe('validateExamples', () => {
  it('正しい配列はそのまま返す', () => {
    expect(validateExamples([validExample])).toEqual([validExample])
  })
  it('配列でなければエラー', () => {
    expect(() => validateExamples({} as unknown)).toThrow('examples は配列である必要があります')
  })
  it('空配列はエラー', () => {
    expect(() => validateExamples([])).toThrow('examples が空です')
  })
  it('必須フィールド欠如はエラー', () => {
    const bad = { ...validExample, content: '' }
    expect(() => validateExamples([bad])).toThrow(/content/)
  })
  it('metricsにimpressions/likesが無ければエラー', () => {
    const bad = { ...validExample, metrics: { impressions: 1 } as unknown }
    expect(() => validateExamples([bad])).toThrow(/metrics/)
  })
})

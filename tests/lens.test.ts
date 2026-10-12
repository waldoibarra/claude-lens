import { describe, expect, test } from 'claude-code/testing'

import type { LensStep } from '../types'
import {
  cleanFoldLine,
  countsSummary,
  modelName,
  foldOf,
  normalRunLine,
  questionLine,
  questionPairs,
  rawErrorLine,
  relabelError,
  stepDetail,
  stepKind,
  stepLabel,
} from '../hooks/lens'

const step = (id: string, tool: string, over: Partial<LensStep> = {}): LensStep => ({
  id,
  turn: 't1',
  run: 0,
  tool,
  label: stepLabel(tool, {}),
  kind: stepKind(tool),
  status: 'ok',
  ...over,
})

describe('labels', () => {
  test('never show a raw command, full path or id', () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['Read', { file_path: '/Users/me/project/src/app.ts' }, 'Read app.ts'],
      ['Edit', { file_path: '/Users/me/project/README.md' }, 'Edited README.md'],
      [
        'Bash',
        { command: 'rm -rf /tmp/x && ls -la', description: 'Clean the build folder' },
        'Clean the build folder',
      ],
      ['Bash', { command: 'git status --porcelain' }, 'Ran a shell command'],
      ['Grep', { pattern: 'TODO', path: '/Users/me' }, 'Searched the code'],
      ['WebFetch', { url: 'https://docs.example.com/a/b?c=1' }, 'Read a page on docs.example.com'],
      ['Agent', { description: 'Find usages', prompt: 'long prompt' }, 'Delegated: Find usages'],
      ['mcp__claude_ai_Google_Drive__search_files', { q: 'x' }, 'Used google drive: search files'],
    ]
    for (const [tool, input, label] of cases) {
      const got = stepLabel(tool, input)
      expect(got).toBe(label)
      expect(got).not.toMatch(/\/Users|rm -rf|git status|toolu_|\?c=1/)
    }
  })

  test('scrub paths and ids out of free-text descriptions', () => {
    const got = stepLabel('Bash', {
      description: 'Check /Users/me/project/logs/out.log for 0c8f6b3a-1d2e-4f5a-9b8c-7d6e5f4a3b2c',
    })
    expect(got).toBe('Check out.log for')
  })
})

describe('error relabeling', () => {
  test('turns raw errors into one line that says what happened and what to do', () => {
    const cases: Array<[string, RegExp]> = [
      [
        'Error: ENOENT: no such file or directory, open /x/y.ts',
        /^File or folder not found\. Check/,
      ],
      ['zsh: command not found: rg', /^A required program is not installed\./],
      ['Exit code 2\nnpm ERR! missing script', /^The command failed \(exit 2\)\. Press Ctrl\+O/],
      ["The user doesn't want to proceed with this tool use.", /^You declined this step\./],
      [
        'File has not been read yet. Read it first before writing to it.',
        /^Claude must read the file/,
      ],
      [
        '<tool_use_error>String to replace not found in file.</tool_use_error>',
        /^The text to change was not found\./,
      ],
      ['Request failed with status 429', /^Rate limited\./],
      ['connect ECONNREFUSED 127.0.0.1:5432', /^Network request failed\./],
      ['something nobody anticipated', /^The step failed\. Press Ctrl\+O/],
    ]
    for (const [raw, line] of cases) {
      const got = relabelError(raw)
      expect(got).toMatch(line)
      expect(got).not.toContain('\n')
      expect(got).not.toContain(raw)
    }
  })
})

describe('fold counts', () => {
  const all = [
    step('a', 'Read'),
    step('b', 'Read'),
    step('c', 'Bash', {
      status: 'error',
      error: 'The command failed (exit 1). Press Ctrl+O to see its output.',
    }),
    step('d', 'Edit', { run: 1 }),
    step('q', 'AskUserQuestion', { run: 1 }),
    step('z', 'Read', { turn: 't2' }),
  ]

  test('clean folds every step of a turn, questions excluded', () => {
    const fold = foldOf(all, all[0]!, 'turn')
    expect(fold.steps.map(s => s.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(fold.failed).toBe(1)
    expect(cleanFoldLine(fold, false)).toBe('▸ 4 steps · 1 failed')
    expect(cleanFoldLine(fold, true)).toBe('▾ 4 steps · 1 failed')
  })

  test('normal draws one line per run with counts', () => {
    expect(normalRunLine(foldOf(all, all[0]!, 'run'))).toBe(
      '• Read 2 files, ran 1 command (1 failed)',
    )
    expect(normalRunLine(foldOf(all, all[3]!, 'run'))).toBe('• Changed 1 file')
    expect(countsSummary([step('x', 'Grep'), step('y', 'Glob'), step('w', 'WebSearch')])).toBe(
      'ran 2 searches, made 1 web lookup',
    )
  })
})

describe('questions', () => {
  test('an answered question folds into one line', () => {
    const line = questionLine(
      {
        questions: [
          { header: 'Library', question: 'Which library?', options: [], multiSelect: false },
        ],
        answers: { 'Which library?': 'date-fns' },
      },
      false,
    )
    expect(line).toBe('? Answered Library: date-fns')
    expect(questionLine("The user doesn't want to proceed", true)).toMatch(
      /^\? Question skipped\. You declined/,
    )
  })
})

describe('model names', () => {
  test('turn model ids into display names', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelName('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
    expect(modelName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(modelName('us.anthropic.claude-haiku-5-5-v1:0')).toBe('Haiku 5.5')
    expect(modelName('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
    expect(modelName('claude-opus-4')).toBe('Opus 4')
    expect(modelName('gpt-6-astra')).toBe('GPT 6 Astra')
    expect(modelName('openai/gpt-oss-120b')).toBe('openai/GPT OSS 120B')
    expect(modelName('gemini-2-5-pro')).toBe('Gemini 2 5 Pro')
    expect(modelName('openrouter/some-new-model')).toBe('openrouter/some-new-model')
    expect(modelName('vendor/claude-custom')).toBe('vendor/claude-custom')
    expect(modelName('claude-custom')).toBe('claude-custom')
    expect(modelName(undefined)).toBe('Claude')
  })
})

describe('step facts (normal view)', () => {
  test('one short fact from each result, never guessed', () => {
    expect(stepDetail('Bash', {}, { stdout: '' }, undefined)).toBe('exit 0')
    expect(stepDetail('Bash', {}, undefined, undefined)).toBeUndefined()
    expect(stepDetail('Bash', {}, undefined, 'Exit code 2\nboom')).toBe('exit 2')
    expect(stepDetail('Bash', {}, undefined, 'killed')).toBeUndefined()
    expect(stepDetail('Read', {}, { type: 'text', file: { numLines: 34 } }, undefined)).toBe(
      '34 lines',
    )
    expect(
      stepDetail('Edit', {}, { structuredPatch: [{ lines: [' a', '-b', '+c', '+d'] }] }, undefined),
    ).toBe('+2 −1 lines')
    expect(stepDetail('Write', {}, { type: 'create', content: 'a\nb\nc\n' }, undefined)).toBe(
      '+3 lines',
    )
    expect(stepDetail('Agent', {}, { totalDurationMs: 12_400 }, undefined)).toBe('12s')
    expect(stepDetail('Agent', {}, { agentId: 'x' }, undefined)).toBeUndefined()
    expect(stepDetail('WebFetch', { url: 'https://example.com/a' }, {}, undefined)).toBe(
      'example.com',
    )
    expect(stepDetail('TodoWrite', {}, {}, undefined)).toBeUndefined()
  })

  test('the raw error keeps its first meaningful line, paths shortened', () => {
    expect(
      rawErrorLine('Exit code 1\nls: /nonexistent/lens-probe: No such file or directory'),
    ).toBe('ls: …/lens-probe: No such file or directory')
    expect(
      rawErrorLine('<tool_use_error>String to replace not found in file.</tool_use_error>'),
    ).toBe('String to replace not found in file.')
    expect(rawErrorLine('x'.repeat(300))).toHaveLength(160)
    expect(rawErrorLine(undefined)).toBeUndefined()
  })
})

describe('question details', () => {
  test('pair each question with its answer, or mark it skipped', () => {
    const asked = {
      questions: [
        { header: 'Lib', question: 'Which library?' },
        { header: 'Scope', question: 'Which scope?' },
      ],
    }
    expect(questionPairs(asked, { ...asked, answers: { 'Which library?': 'date-fns' } })).toEqual([
      { header: 'Lib', question: 'Which library?', answer: 'date-fns' },
      { header: 'Scope', question: 'Which scope?', answer: '(no answer)' },
    ])
    expect(questionPairs(asked, "The user doesn't want to proceed")).toEqual([
      { header: 'Lib', question: 'Which library?', answer: '(skipped)' },
      { header: 'Scope', question: 'Which scope?', answer: '(skipped)' },
    ])
  })
})

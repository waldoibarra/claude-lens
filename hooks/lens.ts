// Pure logic for lens: labels, error relabeling, fold summaries.
// No `$`, no model calls: everything here is string work over plain data.

import type { LensStep } from '../types'

type Input = Record<string, unknown>

const str = (input: Input, key: string): string => {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : ''
}

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? ''

const hostName = (url: string): string => {
  const match = /^[a-z]+:\/\/([^/:?#]+)/i.exec(url)
  return match?.[1] ?? ''
}

// Drops anything that looks like a raw command, path or ID from free text.
const scrub = (text: string): string =>
  text
    .replace(/(?:~|\.{1,2})?\/[\w.@-]+(?:\/[\w.@-]+)+/g, m => baseName(m))
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/\btoolu_[A-Za-z0-9]+\b/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

const MODEL_FAMILIES: Record<string, string> = {
  gpt: 'GPT',
  gemini: 'Gemini',
  grok: 'Grok',
  deepseek: 'DeepSeek',
  llama: 'Llama',
  mistral: 'Mistral',
  mixtral: 'Mixtral',
  qwen: 'Qwen',
  glm: 'GLM',
  kimi: 'Kimi',
}

const readableModelId = (id: string): string => {
  const slash = id.lastIndexOf('/')
  const namespace = id.slice(0, slash + 1)
  const name = id.slice(slash + 1)
  const family = /^(gpt|gemini|grok|deepseek|llama|mistral|mixtral|qwen|glm|kimi)(?=-|\d)/i.exec(
    name,
  )
  if (!family && !/^o\d+(?:-|$)/.test(name)) return id
  const words = name.split('-').map((word, index) => {
    if (index === 0) {
      if (!family) return word
      return MODEL_FAMILIES[family[1]!.toLowerCase()] + word.slice(family[1]!.length)
    }
    if (/^(?:oss|vl|\d+b|[rv]\d+(?:\.\d+)?)$/i.test(word)) return word.toUpperCase()
    return capitalize(word)
  })
  return namespace + words.join(' ')
}

const humanize = (name: string): string =>
  name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim()

/** What kind of step a tool is, for counts: read, search, edit, command, ... */
export const stepKind = (tool: string): string => {
  if (tool === 'Read' || tool === 'NotebookRead') return 'read'
  if (tool === 'Grep' || tool === 'Glob' || tool === 'ToolSearch') return 'search'
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return 'edit'
  if (tool === 'Bash' || tool === 'Monitor') return 'command'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'web'
  if (tool === 'Agent' || tool === 'Task' || tool === 'SendMessage') return 'agent'
  if (tool === 'AskUserQuestion') return 'question'
  if (tool === 'Skill') return 'skill'
  if (tool.startsWith('mcp__')) return 'integration'
  return 'other'
}

/** A plain label for one step: never the raw command, full path or an ID. */
export const stepLabel = (tool: string, raw: unknown): string => {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Input
  const file = baseName(
    str(input, 'file_path') || str(input, 'notebook_path') || str(input, 'path'),
  )
  switch (tool) {
    case 'Read':
    case 'NotebookRead':
      return file ? `Read ${file}` : 'Read a file'
    case 'Edit':
    case 'NotebookEdit':
      return file ? `Edited ${file}` : 'Edited a file'
    case 'Write':
      return file ? `Wrote ${file}` : 'Wrote a file'
    case 'Grep':
      return 'Searched the code'
    case 'Glob':
      return 'Looked for files'
    case 'ToolSearch':
      return 'Loaded tools'
    case 'Bash': {
      const description = scrub(str(input, 'description'))
      return description ? capitalize(description) : 'Ran a shell command'
    }
    case 'Monitor':
      return 'Watched a background task'
    case 'WebFetch': {
      const host = hostName(str(input, 'url'))
      return host ? `Read a page on ${host}` : 'Read a web page'
    }
    case 'WebSearch':
      return 'Searched the web'
    case 'Agent':
    case 'Task': {
      const description = scrub(str(input, 'description'))
      return description ? `Delegated: ${description}` : 'Delegated to a helper agent'
    }
    case 'SendMessage':
      return 'Messaged a helper agent'
    case 'Skill': {
      const skill = str(input, 'skill').split(':').pop() ?? ''
      return skill ? `Loaded the ${humanize(skill)} skill` : 'Loaded a skill'
    }
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'Updated the task list'
    case 'AskUserQuestion':
      return 'Asked you a question'
    case 'EnterPlanMode':
      return 'Started planning'
    case 'ExitPlanMode':
      return 'Presented a plan'
    default: {
      if (tool.startsWith('mcp__')) {
        const [, server = '', name = ''] = tool.split('__')
        const service = humanize(server.replace(/^claude_ai_/, ''))
        return `Used ${service}: ${humanize(name)}`
      }
      return capitalize(humanize(tool)) || 'Ran a step'
    }
  }
}

const RULES: ReadonlyArray<[RegExp, string]> = [
  [
    new RegExp(
      "doesn't want to proceed|user (?:rejected|denied|declined)|" +
        'permission to use .* (?:was|has been) denied',
      'i',
    ),
    'You declined this step. Tell Claude how to proceed.',
  ],
  [
    /interrupted|aborted by user|request was aborted/i,
    'Stopped by you. Send a message to continue.',
  ],
  [
    /has not been read yet|read it first/i,
    'Claude must read the file before changing it. It will retry.',
  ],
  [
    /string to replace not found|old_string.*not found|no match(?:es)? found for/i,
    'The text to change was not found. Claude should re-read the file.',
  ],
  [
    /found \d+ matches of the string to replace/i,
    'The text to change appears more than once. Claude should give more context.',
  ],
  [
    /ENOENT|no such file or directory|does not exist|file not found/i,
    'File or folder not found. Check the name, or ask Claude to search for it.',
  ],
  [
    /EACCES|EPERM|permission denied|operation not permitted/i,
    'Permission denied. Check file permissions or run with access.',
  ],
  [
    /command not found|not recognized as an internal|executable file not found/i,
    'A required program is not installed. Install it or ask for another way.',
  ],
  [
    /timed? ?out|ETIMEDOUT|deadline exceeded/i,
    'The step timed out. Retry it, or run it in the background.',
  ],
  [/\b429\b|rate.?limit|too many requests/i, 'Rate limited. Wait a moment, then retry.'],
  [
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|fetch failed|socket hang up|getaddrinfo/i,
    'Network request failed. Check the connection or the address.',
  ],
  [
    /\b(?:401|403)\b|unauthori[sz]ed|forbidden|authentication/i,
    'Access was refused. Sign in again or check credentials.',
  ],
  [/\b404\b|not found/i, 'Not found. Check the name or address.'],
  [
    /exit code (\d+)|exited with (?:code )?(\d+)/i,
    'The command failed (exit $1). Press Ctrl+O to see its output.',
  ],
  [
    /syntax ?error|unexpected token|parse error/i,
    'A syntax error stopped the step. Claude should fix the code and retry.',
  ],
]

/** One plain line: what happened and what to do. Never the raw error text. */
export const relabelError = (raw: unknown): string => {
  const text = typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw)
  for (const [pattern, line] of RULES) {
    const match = pattern.exec(text)
    if (match) return line.replace('$1', match[1] ?? match[2] ?? '?')
  }
  return 'The step failed. Press Ctrl+O to see the details.'
}

const NOUNS: Record<string, [string, string, string]> = {
  read: ['read', 'file', 'files'],
  search: ['ran', 'search', 'searches'],
  edit: ['changed', 'file', 'files'],
  command: ['ran', 'command', 'commands'],
  web: ['made', 'web lookup', 'web lookups'],
  agent: ['delegated', 'task', 'tasks'],
  skill: ['loaded', 'skill', 'skills'],
  integration: ['used', 'integration', 'integrations'],
  other: ['took', 'other step', 'other steps'],
}

const ORDER = ['read', 'search', 'edit', 'command', 'web', 'agent', 'skill', 'integration', 'other']

/** `read 2 files, ran 3 commands`: counts per kind, in a fixed order. */
export const countsSummary = (steps: readonly LensStep[]): string => {
  const counts = new Map<string, number>()
  for (const step of steps) counts.set(step.kind, (counts.get(step.kind) ?? 0) + 1)
  return ORDER.filter(kind => counts.has(kind))
    .map(kind => {
      const n = counts.get(kind) ?? 0
      const [verb, one, many] = NOUNS[kind] ?? NOUNS.other!
      return `${verb} ${n} ${n === 1 ? one : many}`
    })
    .join(', ')
}

export type Fold = {
  /** Steps folded under this line (questions excluded). */
  steps: LensStep[]
  failed: number
  running: boolean
  /** The relabeled line for the most recent failure, if any. */
  lastError?: string
}

/** The steps of one fold: a turn's (clean) or a run's (normal). */
export const foldOf = (all: readonly LensStep[], anchor: LensStep, by: 'turn' | 'run'): Fold => {
  const steps = all.filter(
    s => s.kind !== 'question' && s.turn === anchor.turn && (by === 'turn' || s.run === anchor.run),
  )
  const failures = steps.filter(s => s.status === 'error')
  return {
    steps,
    failed: failures.length,
    running: steps.some(s => s.status === 'running'),
    lastError: failures.at(-1)?.error,
  }
}

/** The id of the step that draws the fold line; every other row draws nothing. */
export const anchorId = (
  all: readonly LensStep[],
  step: LensStep,
  by: 'turn' | 'run',
): string | undefined =>
  all.find(
    s => s.kind !== 'question' && s.turn === step.turn && (by === 'turn' || s.run === step.run),
  )?.id

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Normal view lists at most this many steps per run until opened. */
export const NORMAL_MAX_STEPS = 5

/** Clean view's run line: the step count and failures, nothing more. */
export const cleanFoldLine = (fold: Fold, isOpen: boolean): string => {
  const parts = [plural(fold.steps.length, 'step', 'steps')]
  if (fold.failed > 0) parts.push(`${fold.failed} failed`)
  return `${isOpen ? '▾' : '▸'} ${parts.join(' · ')}`
}

/** Normal view's run line: counts per kind, failures, and a hidden current step. */
export const normalRunLine = (fold: Fold, currentHidden?: string): string => {
  const summary = capitalize(countsSummary(fold.steps)) || 'No steps'
  const failed = fold.failed > 0 ? ` (${fold.failed} failed)` : ''
  const current = currentHidden ? ` · Current: ${currentHidden}` : ''
  return `• ${summary}${failed}${current}`
}

const lineCount = (text: string): number =>
  text === '' ? 0 : text.replace(/\n$/, '').split('\n').length

const patchCounts = (patch: unknown): [number, number] | undefined => {
  if (!Array.isArray(patch)) return undefined
  let added = 0
  let removed = 0
  for (const hunk of patch) {
    for (const line of ((hunk as { lines?: unknown }).lines as string[]) ?? []) {
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
  }
  return [added, removed]
}

const seconds = (ms: number): string =>
  ms < 60_000
    ? `${Math.max(1, Math.round(ms / 1000))}s`
    : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`

/**
 * One short fact from what a step returned, for normal view; undefined where
 * the result does not carry it, never guessed.
 */
export const stepDetail = (
  tool: string,
  input: unknown,
  result: unknown,
  failure: string | undefined,
): string | undefined => {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>
  const inp = (input && typeof input === 'object' ? input : {}) as Input
  switch (tool) {
    case 'Bash': {
      if (failure === undefined) return result === undefined ? undefined : 'exit 0'
      const code = /exit code (\d+)/i.exec(failure)?.[1]
      return code ? `exit ${code}` : undefined
    }
    case 'Read': {
      const file = r.file as { numLines?: unknown } | undefined
      return typeof file?.numLines === 'number' ? plural(file.numLines, 'line', 'lines') : undefined
    }
    case 'Edit':
    case 'Write': {
      if (failure !== undefined) return undefined
      if (r.type === 'create' && typeof r.content === 'string')
        return `+${lineCount(r.content)} lines`
      const counts = patchCounts(r.structuredPatch)
      if (counts) return `+${counts[0]} −${counts[1]} lines`
      if (tool === 'Write' && typeof inp.content === 'string')
        return `+${lineCount(inp.content)} lines`
      return undefined
    }
    case 'Grep':
    case 'Glob': {
      const n = r.numMatches ?? r.numFiles ?? r.numLines
      return typeof n === 'number' ? plural(n, 'match', 'matches') : undefined
    }
    case 'Agent':
    case 'Task':
      return typeof r.totalDurationMs === 'number' ? seconds(r.totalDurationMs) : undefined
    case 'WebFetch': {
      const host = hostName(str(inp, 'url'))
      return host || undefined
    }
    default:
      return undefined
  }
}

/** The raw error's first meaningful line, paths cut to file names. */
export const rawErrorLine = (failure: string | undefined): string | undefined => {
  if (!failure) return undefined
  const line = failure
    .replace(/<\/?[a-z_]+>/gi, '')
    .split('\n')
    .map(l => l.trim())
    .find(l => l !== '' && !/^exit code \d+$/i.test(l))
  if (!line) return undefined
  const short = line.replace(/(?:~|\.{1,2})?\/[\w.@-]+(?:\/[\w.@-]+)+/g, m => `…/${baseName(m)}`)
  return short.length > 160 ? `${short.slice(0, 159)}…` : short
}

export const statusGlyph = (status: LensStep['status']): string =>
  status === 'ok' ? '✓' : status === 'error' ? '✗' : status === 'interrupted' ? '◌' : '…'

/** One line for an answered AskUserQuestion call. */
export const questionLine = (output: unknown, isErrored: boolean): string => {
  if (isErrored || typeof output === 'string' || output == null) {
    return `? Question skipped. ${relabelError(output)}`
  }
  const record = output as {
    questions?: Array<{ header?: string; question?: string }>
    answers?: Record<string, string>
    response?: string
  }
  const questions = record.questions ?? []
  const answers = record.answers ?? {}
  const pairs = questions.map(q => {
    const answer = answers[q.question ?? ''] ?? '(no answer)'
    return `${q.header || 'Question'}: ${answer}`
  })
  if (pairs.length === 0 && record.response) pairs.push(`Answer: ${record.response}`)
  return `? Answered ${pairs.join(' · ') || 'a question'}`
}

export type QuestionPair = { header: string; question: string; answer: string }

/**
 * Each question asked and the answer given, for a click to show. Questions
 * come from the result, else from the call's input (a skipped question).
 */
export const questionPairs = (input: unknown, output: unknown): QuestionPair[] => {
  type Q = { header?: string; question?: string }
  const record = (output && typeof output === 'object' ? output : {}) as {
    questions?: Q[]
    answers?: Record<string, string>
    response?: string
  }
  const asked = (input && typeof input === 'object' ? input : {}) as { questions?: Q[] }
  const questions = record.questions ?? asked.questions ?? []
  const answers = record.answers ?? {}
  const answered = typeof output === 'object' && output !== null
  return questions.map((q, n) => ({
    header: q.header || 'Question',
    question: q.question ?? '',
    answer:
      answers[q.question ?? ''] ??
      (n === 0 && record.response ? record.response : answered ? '(no answer)' : '(skipped)'),
  }))
}

/** A key that finds a message's stamp by its text when its id is unknown. */
export const stampKey = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 120)

/** HH:MM at the given UTC offset in minutes (null: the runtime's local time). */
export const formatTime = (at: number, tzOffset: number | null): string => {
  const date = tzOffset === null ? new Date(at) : new Date(at + tzOffset * 60_000)
  const hours = tzOffset === null ? date.getHours() : date.getUTCHours()
  const minutes = tzOffset === null ? date.getMinutes() : date.getUTCMinutes()
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** Parses `date +%z` output (`-0600`) into minutes. */
export const parseOffset = (text: string): number | null => {
  const match = /^([+-])(\d{2})(\d{2})$/.exec(text.trim())
  if (!match) return null
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

/**
 * A display name for a model id: `claude-opus-5-5` → `Opus 5.5`,
 * `gpt-6-astra` → `GPT 6 Astra`; unknown ids stay unchanged.
 */
export const modelName = (id: string | undefined): string => {
  if (id === undefined) return 'Claude'
  const original = id.trim()
  if (original === '') return 'Claude'
  const raw = original
    .toLowerCase()
    .replace(/\[.*\]$/, '')
    .replace(/^.*?(claude-)/, '$1')
  if (!raw.startsWith('claude-')) return readableModelId(original)
  const modern = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:-v\d.*)?$/.exec(raw)
  if (modern) return `${capitalize(modern[1]!)} ${modern[2]}${modern[3] ? `.${modern[3]}` : ''}`
  const legacy = /^claude-(\d+)(?:-(\d+))?-([a-z]+)/.exec(raw)
  if (legacy) return `${capitalize(legacy[3]!)} ${legacy[1]}${legacy[2] ? `.${legacy[2]}` : ''}`
  return original
}

export const VIEWS = ['clean', 'normal', 'raw'] as const

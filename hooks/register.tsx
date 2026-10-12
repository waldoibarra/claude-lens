import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import type { LensStamp, LensStep, LensView } from '../types'
import {
  VIEWS,
  anchorId,
  cleanFoldLine,
  foldOf,
  formatTime,
  modelName,
  NORMAL_MAX_STEPS,
  normalRunLine,
  rawErrorLine,
  parseOffset,
  questionLine,
  questionPairs,
  relabelError,
  stampKey,
  statusGlyph,
  stepDetail,
  stepKind,
  stepLabel,
} from './lens'

// All state lives in `$.state`, so a hot reload keeps the view, the steps
// and which folds are open. The drawing reads it; only events write it.
const view = atom({ plugin: 'lens', key: 'view' } as const, 'normal')
const steps = atom({ plugin: 'lens', key: 'steps' } as const, [])
const cursor = atom({ plugin: 'lens', key: 'cursor' } as const, {
  turn: '',
  run: 0,
  sawText: false,
})
const current = atom({ plugin: 'lens', key: 'current' } as const, null)
const expanded = atom({ plugin: 'lens', key: 'expanded' } as const, [])
const stamps = atom({ plugin: 'lens', key: 'stamps' } as const, [])
const tzOffset = atom({ plugin: 'lens', key: 'tzOffset' } as const, null)

const MAX_STEPS = 600
const MAX_STAMPS = 400
// The API marks the ctrl+o transcript on UserMessage and ToolGroup only.
// A row that says so opens this window; rows drawn inside it pass through.
const TRANSCRIPT_WINDOW_MS = 3000

type Dollar = EngineInterface
type Step = LensStep

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .filter(
          (b): b is { type: 'text'; text: string } =>
            b?.type === 'text' && typeof b.text === 'string',
        )
        .map(b => b.text)
        .join('\n')
    : typeof content === 'string'
      ? content
      : ''

let transcriptSeenAt = 0
let groupedToolUseIds: string[] = []
function transcriptOpen(): boolean {
  return Date.now() - transcriptSeenAt < TRANSCRIPT_WINDOW_MS
}

function stamp($: Dollar, entry: LensStamp) {
  return update($, stamps, list => [...list, entry].slice(-MAX_STAMPS))
}

function toggle($: Dollar, key: string) {
  return update($, expanded, list =>
    list.includes(key) ? list.filter(k => k !== key) : [...list, key],
  )
}

type ToolUseInput = RenderInput<'ToolUse'>
type ToolUseNext = (e: ToolUseInput) => Promise<RenderElement>

const stepOpenKey = (id: string): string => `step:${id}`
const questionOpenKey = (id: string): string => `q:${id}`

function visibleSteps(all: readonly Step[], step: Step, v: LensView, openKeys: readonly string[]) {
  const fold = foldOf(all, step, 'run')
  const runOpen = openKeys.includes(`${step.turn}#${step.run}`)
  return v === 'clean'
    ? runOpen
      ? fold.steps
      : []
    : runOpen
      ? fold.steps
      : fold.steps.slice(0, NORMAL_MAX_STEPS)
}

function isVisibleStep(all: readonly Step[], step: Step, v: LensView, openKeys: readonly string[]) {
  return visibleSteps(all, step, v, openKeys).some(s => s.id === step.id)
}

function isLastVisibleStep(
  all: readonly Step[],
  step: Step,
  v: LensView,
  openKeys: readonly string[],
) {
  return visibleSteps(all, step, v, openKeys).at(-1)?.id === step.id
}

// The facts after a step's label: a sub-agent's model (both views), then in
// normal the step's own fact (`exit 0`, `12s`).
function stepFacts(s: Step, isClean: boolean) {
  const facts = [
    s.agentModel ? modelName(s.agentModel) : undefined,
    isClean ? undefined : s.detail,
  ].filter(Boolean)
  return facts.length > 0 ? ` · ${facts.join(' · ')}` : ''
}

function statusOf(p: ToolUseInput['props']): Step['status'] {
  return p.isRunning ? 'running' : p.isInterrupted ? 'interrupted' : p.isErrored ? 'error' : 'ok'
}

async function nativeToolUse(
  $: Dollar,
  e: ToolUseInput,
  next: ToolUseNext,
): Promise<RenderElement> {
  const { Box } = $.ui.resolve(e)
  return (
    <Box key={`native-${e.props.tool_use_id}`} flexDirection="column" paddingLeft={2}>
      {await next(e)}
    </Box>
  )
}

async function drawToolUseStep(
  $: Dollar,
  e: ToolUseInput,
  all: readonly Step[],
  step: Step,
  v: LensView,
  next: ToolUseNext,
) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const anchor = anchorId(all, step, 'run')
  const isAnchor = anchor === step.id
  const fold = foldOf(all, step, 'run')
  const key = `${step.turn}#${step.run}`
  const openKeys = await read($, expanded)
  const runOpen = openKeys.includes(key)
  const isClean = v === 'clean'
  const shown = visibleSteps(all, step, v, openKeys)
  const isVisible = shown.some(s => s.id === step.id)
  const totalHidden = Math.max(0, fold.steps.length - NORMAL_MAX_STEPS)
  const currentHidden =
    !isClean && !runOpen
      ? fold.steps.find((s, index) => index >= NORMAL_MAX_STEPS && s.status === 'running')
      : undefined
  const lastPreview = fold.steps[Math.min(fold.steps.length, NORMAL_MAX_STEPS) - 1]?.id
  const drawsToggleAfterPreview = !isClean && totalHidden > 0 && lastPreview === step.id
  const lastVisible = shown.at(-1)?.id
  const drawsAfterRun = shown.length === 0 ? isAnchor : lastVisible === step.id
  const stepOpen = openKeys.includes(stepOpenKey(step.id))
  const inlineGroupedResult = groupedToolUseIds.includes(step.id)
  // The API says expanded ToolGroup rows draw results inline on ToolUse,
  // while standalone rows own a separate ToolResult. Running rows have no result yet.
  const footerFollowsResult =
    isVisible && stepOpen && drawsAfterRun && !inlineGroupedResult && step.status !== 'running'
  if (!isAnchor && !isVisible && !drawsAfterRun) return <Box key="folded" display="none" />

  const first = fold.steps[0]
  const runLabel =
    drawsAfterRun && !footerFollowsResult && first?.at !== undefined
      ? await stampLabel($, null, {
          id: first.id,
          key: '',
          at: first.at,
          ...(first.model ? { model: first.model } : {}),
        })
      : undefined

  return (
    <Box key="fold" flexDirection="column" width="100%">
      {isAnchor &&
        (isClean ? (
          <Button
            key="toggle"
            plain
            dimColor
            label={cleanFoldLine(fold, runOpen)}
            onPress={() => toggle($, key)}
          />
        ) : fold.steps.length > 1 ? (
          <Box key="line">
            <Text color="inactive">{normalRunLine(fold, currentHidden?.label)}</Text>
          </Box>
        ) : null)}
      {isVisible && (
        <Box flexDirection="column" paddingLeft={2}>
          <Button
            key={`step-${step.id}`}
            plain
            dimColor
            label={`${stepOpen ? '▾' : '▸'} ${statusGlyph(step.status)} ${step.label}${stepFacts(
              step,
              isClean,
            )}`}
            onPress={() => toggle($, stepOpenKey(step.id))}
          />
          {step.error && (
            <Text color="error" wrap="truncate-end">
              {'  '}
              {step.error}
            </Text>
          )}
          {!isClean && step.rawError && (
            <Text color="inactive" wrap="truncate-end">
              {'  '}
              {step.rawError}
            </Text>
          )}
          {stepOpen && (await nativeToolUse($, e, next))}
        </Box>
      )}
      {drawsToggleAfterPreview && (
        <Box key={runOpen ? 'fewer' : 'more'} paddingLeft={2}>
          <Button
            key={runOpen ? 'fewer-toggle' : 'more-toggle'}
            plain
            dimColor
            label={runOpen ? 'show fewer' : `+${totalHidden} more`}
            onPress={() => toggle($, key)}
          />
        </Box>
      )}
      {drawsAfterRun && isClean && !runOpen && fold.lastError && (
        <Text color="error" wrap="truncate-end">
          {'  ✗ '}
          {fold.lastError}
        </Text>
      )}
      {runLabel && (
        <Box key="label" justifyContent="flex-end">
          <Text color="inactive">{runLabel}</Text>
        </Box>
      )}
    </Box>
  )
}

async function drawHistoricalToolUse($: Dollar, e: ToolUseInput, next: ToolUseNext) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const p = e.props
  const key = stepOpenKey(p.tool_use_id)
  const open = (await read($, expanded)).includes(key)
  const status = statusOf(p)
  const failure = p.isErrored
    ? typeof p.output === 'string'
      ? p.output
      : undefined
    : p.isInterrupted
      ? typeof p.output === 'string'
        ? p.output
        : 'interrupted'
      : undefined
  const detail = p.isRunning ? undefined : stepDetail(p.tool, p.input, p.output, failure)
  return (
    <Box key="historical" flexDirection="column" width="100%">
      <Button
        key={`step-${p.tool_use_id}`}
        plain
        dimColor
        label={`${open ? '▾' : '▸'} ${statusGlyph(status)} ${stepLabel(p.tool, p.input)}${
          detail ? ` · ${detail}` : ''
        }`}
        onPress={() => toggle($, key)}
      />
      {status === 'error' && (
        <Text color="error">
          {'  '}
          {relabelError(p.output)}
        </Text>
      )}
      {open && (await nativeToolUse($, e, next))}
    </Box>
  )
}

async function findStamp($: Dollar, id: string, text: string) {
  const list = await read($, stamps)
  const key = stampKey(text)
  return list.find(s => s.id === id) ?? [...list].reverse().find(s => s.key === key)
}

async function stampLabel($: Dollar, who: string | null, hit: LensStamp | undefined) {
  const name = who ?? modelName(hit?.model)
  if (!hit) return name
  return `${name} · ${formatTime(hit.at, await read($, tzOffset))}`
}

// `You · 10:22`, or the replying model's name (`Opus 5.5 · 10:22`) when
// `who` is null; the time is left off for a message this mod never saw.
async function label($: Dollar, who: string | null, id: string, text: string) {
  return stampLabel($, who, await findStamp($, id, text))
}

// The sub-agent a step started: its id from the result (a background launch
// says it in the text), and its model when the result names one.
function agentOf(result: unknown, text: string | undefined) {
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>
  const agentId =
    typeof r.agentId === 'string' ? r.agentId : /agentId:\s*([\w-]+)/.exec(text ?? '')?.[1]
  const agentModel = typeof r.resolvedModel === 'string' ? r.resolvedModel : undefined
  return { ...(agentId ? { agentId } : {}), ...(agentModel ? { agentModel } : {}) }
}

// A background task's "finished" row: the sub-agent's model and finish time,
// gray and right-aligned like a run's label.
async function drawNotice(
  $: Dollar,
  e: RenderInput<'UserMessage'>,
  next: (e: RenderInput<'UserMessage'>) => Promise<RenderElement>,
) {
  const task = e.props.task
  const step = task?.toolUseId
    ? (await read($, steps)).find(s => s.id === task.toolUseId)
    : undefined
  if (!step?.agentModel) return next(e)
  const finished =
    step.at !== undefined && task?.durationMs !== undefined ? step.at + task.durationMs : undefined
  const text =
    finished === undefined
      ? modelName(step.agentModel)
      : `${modelName(step.agentModel)} · ${formatTime(finished, await read($, tzOffset))}`
  const { Box, Text } = $.ui.resolve(e)
  const inner = await next(e)
  return (
    <Box flexDirection="column">
      {inner}
      <Box key="label" justifyContent="flex-end">
        <Text color="inactive">{text}</Text>
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lens',
      description: 'Transcript view: normal (default), clean or raw',
      argumentHint: '[clean|normal|raw]',
      immediate: true,
    })
    try {
      const { stdout, exitCode } = await $.process.run(['date', '+%z'])
      if (exitCode === 0) await update($, tzOffset, () => parseOffset(stdout))
    } catch {
      // Keep the runtime's own clock; timestamps may then show UTC.
    }
    return next(e)
  })

  on('command.run', { command: 'lens' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if ((VIEWS as readonly string[]).includes(arg)) {
      await update($, view, () => arg as LensView)
      return { text: `View: ${arg}.` }
    }
    const now = await read($, view)
    return { text: `View: ${now}. Use /lens clean, /lens normal or /lens raw.` }
  })

  on('turn.start', async ($, e, next) => {
    await update($, cursor, () => ({ turn: e.turnId, run: 0, sawText: false }))
    await update($, current, () => null)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await update($, current, () => null)
    return next(e)
  })

  // Timestamps and run boundaries come from the rows the session keeps.
  on('session.append', async ($, e, next) => {
    if (e.agentId !== undefined && e.door === 'response' && e.origin.kind === 'model') {
      const agentId = e.agentId
      const model = e.origin.model
      const all = await read($, steps)
      if (all.some(s => s.agentId === agentId && s.agentModel !== model)) {
        await update($, steps, list =>
          list.map(s => (s.agentId === agentId ? { ...s, agentModel: model } : s)),
        )
      }
    }
    if (e.agentId === undefined) {
      const text = textOf(e.message.content)
      const at = await $.clock.now()
      if (e.door === 'prompt' && text) await stamp($, { id: e.uuid, key: stampKey(text), at })
      if (e.door === 'response' && e.message.type === 'assistant') {
        const model = e.origin.kind === 'model' ? e.origin.model : undefined
        const hasText = text.trim() !== ''
        await update($, cursor, c => ({
          ...c,
          ...(model ? { model } : {}),
          ...(hasText ? { sawText: true } : {}),
        }))
        if (hasText)
          await stamp($, { id: e.uuid, key: stampKey(text), at, ...(model ? { model } : {}) })
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Every main-loop tool call becomes a step with a plain label.
  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined || !e.tool_use_id) return next(e)
    const id = e.tool_use_id
    const c = await update($, cursor, c =>
      c.sawText ? { ...c, run: c.run + 1, sawText: false } : c,
    )
    const label = stepLabel(e.tool, e)
    const at = await $.clock.now()
    const step: Step = {
      id,
      turn: c.turn,
      run: c.run,
      tool: e.tool,
      label,
      kind: stepKind(e.tool),
      status: 'running',
      at,
      ...(c.model ? { model: c.model } : {}),
    }
    await update($, steps, list => [...list.filter(s => s.id !== id), step].slice(-MAX_STEPS))
    await update($, current, () => label)

    const ran = await next(e)

    const failure = ran.deny ?? (ran.isError ? (ran.text ?? '') : undefined)
    const status: Step['status'] =
      failure === undefined ? 'ok' : /interrupted|aborted/i.test(failure) ? 'interrupted' : 'error'
    const detail = stepDetail(e.tool, e, ran.result, failure)
    const agent =
      e.tool === 'Agent' || String(e.tool) === 'Task' ? agentOf(ran.result, ran.text) : {}
    const facts = {
      ...agent,
      ...(detail ? { detail } : {}),
      ...(status === 'error'
        ? { error: relabelError(failure), rawError: rawErrorLine(failure) }
        : {}),
    }
    await update($, steps, list => list.map(s => (s.id === id ? { ...s, status, ...facts } : s)))
    await update($, current, now => (now === label ? null : now))
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const v = await read($, view)
    if (v === 'raw' || transcriptOpen()) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const p = e.props

    if (p.tool === 'AskUserQuestion') {
      if (p.isRunning) return <Text dimColor>? Waiting for your answer…</Text>
      const key = questionOpenKey(p.tool_use_id)
      const open = (await read($, expanded)).includes(key)
      const pairs = questionPairs(p.input, p.output)
      const line = questionLine(p.output, p.isErrored)
      return (
        <Box key="question" flexDirection="column" width="100%">
          <Button
            key="question-toggle"
            plain
            dimColor
            label={line}
            onPress={() => toggle($, key)}
          />
          {open &&
            pairs.map(q => (
              <Box flexDirection="column" paddingLeft={2}>
                <Text color="inactive">{`${q.header}: ${q.question}`}</Text>
                <Text>{`→ ${q.answer}`}</Text>
              </Box>
            ))}
          {open && (await nativeToolUse($, e, next))}
        </Box>
      )
    }

    const all = await read($, steps)
    const step = all.find(s => s.id === p.tool_use_id)
    if (step) return drawToolUseStep($, e, all, step, v, next)

    return drawHistoricalToolUse($, e, next)
  })

  // Grouped native rows are unfolded so each original ToolUse site can decide
  // whether to show its Lens header, hide itself, or delegate native detail.
  // This preserves unknown siblings in mixed observed/historical groups.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const isTranscript = e.props.isExpanded && e.viewport?.isFullscreen === false
    if (isTranscript) transcriptSeenAt = Date.now()
    const v = await read($, view)
    if (v === 'raw' || isTranscript || transcriptOpen()) return next(e)
    const groupIds = e.props.calls
      .map(call => call.tool_use_id)
      .filter((id): id is string => typeof id === 'string')
    if (groupIds.length > 0) {
      groupedToolUseIds = [
        ...groupedToolUseIds.filter(id => !groupIds.includes(id)),
        ...groupIds,
      ].slice(-MAX_STEPS)
    }
    return next({ ...e, props: { ...e.props, isExpanded: true } })
  })

  // A standalone row's result block stays hidden until its visible ToolUse row is open.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const v = await read($, view)
    if (v === 'raw' || transcriptOpen()) return next(e)
    const openKeys = await read($, expanded)
    const { Box, Text } = $.ui.resolve(e)
    const id = e.props.tool_use_id
    if (e.props.tool === 'AskUserQuestion') {
      if (!openKeys.includes(questionOpenKey(id))) return <Box key="folded" display="none" />
      return next(e)
    }

    const all = await read($, steps)
    const step = all.find(s => s.id === id)
    if (!step) {
      if (openKeys.includes(stepOpenKey(id))) return next(e)
      return <Box key="folded" display="none" />
    }
    if (!openKeys.includes(stepOpenKey(id)) || !isVisibleStep(all, step, v, openKeys))
      return <Box key="folded" display="none" />

    const result = await next(e)
    if (!isLastVisibleStep(all, step, v, openKeys)) return result
    const first = foldOf(all, step, 'run').steps[0]
    const runLabel =
      first?.at === undefined
        ? undefined
        : await stampLabel($, null, {
            id: first.id,
            key: '',
            at: first.at,
            ...(first.model ? { model: first.model } : {}),
          })
    return runLabel ? (
      <Box key="result-with-label" flexDirection="column" width="100%">
        {result}
        <Box key="label" justifyContent="flex-end">
          <Text color="inactive">{runLabel}</Text>
        </Box>
      </Box>
    ) : (
      result
    )
  })

  // Labels sit under each message, right-aligned, in clean and normal alike: a row below
  // the engine's drawing follows it with no gap, so it reads as its footer.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.isExpanded) transcriptSeenAt = Date.now()
    else transcriptSeenAt = 0
    const v = await read($, view)
    const kind = e.props.origin.kind
    if (v !== 'raw' && !e.props.isExpanded && kind === 'task-notification')
      return drawNotice($, e, next)
    if (v === 'raw' || e.props.isExpanded || (kind !== 'composer' && kind !== 'bridge'))
      return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const inner = await next(e)
    return (
      <Box flexDirection="column">
        {inner}
        <Box key="label" justifyContent="flex-end">
          <Text bold color="suggestion">
            {await label($, 'You', e.requestId, e.props.text)}
          </Text>
        </Box>
      </Box>
    )
  })

  // The label marks each message, so the engine's bullet is dropped. Text
  // blocks carry a coloured label; runs of steps a gray one.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const v = await read($, view)
    if (v === 'raw' || transcriptOpen()) return next(e)
    const unbulleted = { ...e, props: { ...e.props, isFirstOfReply: false } }
    if (!e.props.isFirstOfReply) return next(unbulleted)
    const hit = await findStamp($, e.requestId, e.props.text)
    const { Box, Text } = $.ui.resolve(e)
    const inner = await next(unbulleted)
    return (
      <Box flexDirection="column">
        {inner}
        <Box key="label" justifyContent="flex-end">
          <Text bold color="claude">
            {await stampLabel($, null, hit)}
          </Text>
        </Box>
      </Box>
    )
  })

  // The working line: the engine's spinner, its words the current step.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const v = await read($, view)
    if (v === 'raw') return next(e)
    const step = await read($, current)
    const message =
      step ??
      (e.props.mode === 'thinking'
        ? 'Thinking'
        : e.props.mode === 'responding'
          ? 'Writing the reply'
          : null)
    return message === null ? next(e) : next({ ...e, props: { ...e.props, message } })
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const v = await read($, view)
    if (v === 'raw' || !e.props.isErrored) return next(e)
    return next({ ...e, props: { ...e.props, text: relabelError(e.props.text) } })
  })
}

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

type Bottom = { ids: string[]; whileRunning?: (e: { tool: string }) => Promise<void> }

// What the engine would do beneath the plugin: draw `ENGINE`, run tools.
function engineBottom(on: On): Bottom {
  const bottom: Bottom = { ids: [] }
  mock.clock(on, { now: Date.UTC(2026, 9, 8, 15, 4) })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>ENGINE</Text>
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('tool.call', async ($, e) => {
    if (e.tool_use_id) bottom.ids.push(e.tool_use_id)
    await bottom.whileRunning?.(e)
    if (e.tool === 'Bash' && e.command.includes('fail')) {
      return { deny: 'Exit code 1\nnpm ERR! Missing script: "tset"' }
    }
    if (e.tool === 'Read') return { result: { type: 'text', file: { numLines: 12 } } }
    if (e.tool === 'Edit')
      return {
        result: {
          structuredPatch: [
            { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-x', '+y'] },
          ],
        },
      }
    if (e.tool === 'Bash')
      return {
        result: {
          stdout: e.command.includes('quiet') ? '' : 'hello\n',
          stderr: '',
          interrupted: false,
        },
      }
    if (e.tool === 'Agent')
      return {
        result: { agentId: 'helper-1', resolvedModel: 'claude-haiku-5-5', totalDurationMs: 6200 },
      }
    return { result: {} }
  })
  return bottom
}

// One turn: read two files, a reply, then a failing command and an edit.
async function playTurn($: Engine, bottom: Bottom) {
  await $.turn.start({ text: 'fix it', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Read', file_path: '/Users/me/app/src/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/Users/me/app/src/b.ts' })
  await $.session.append({
    door: 'response',
    uuid: 'reply-1',
    origin: { kind: 'model', model: 'claude-opus-5-5' },
    message: {
      type: 'assistant',
      role: 'assistant',
      content: [{ type: 'text', text: 'Running the tests now.' }],
    },
  } as never)
  await $.tool.call({
    tool: 'Bash',
    command: 'npm run tset -- --fail',
    description: 'Run the tests',
  })
  await $.tool.call({
    tool: 'Edit',
    file_path: '/Users/me/app/src/a.ts',
    old_string: 'x',
    new_string: 'y',
  })
  expect(bottom.ids).toHaveLength(4)
  return bottom.ids
}

const toolRow = (id: string, tool: string, input: unknown) => ({
  tool_use_id: id,
  tool,
  input,
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: {},
})

describe('lens rendering', () => {
  test('clean draws one lean line per run', async ($, on) => {
    const steps = await playTurn($, engineBottom(on))
    await $.command.run({ command: 'lens', args: 'clean' } as never)
    for (const surface of SURFACES) {
      const mount = (id: string, tool: string) =>
        $.ui.mount({
          plugin: 'lens',
          surface,
          component: 'ToolUse',
          requestId: id,
          props: toolRow(id, tool, {}),
        })

      // Run 1: the two reads.
      const runOne = await mount(steps[0]!, 'Read')
      expect((await runOne.find({ key: 'toggle' }))?.text).toBe('▸ 2 steps')
      // Run 1 came before any reply row: the cyan label names no model.
      expect((await runOne.findAll({ type: 'Text' })).map(t => [t.text, t.props.color])).toEqual([
        [expect.stringMatching(/^Claude · \d\d:\d\d$/), 'cyan'],
      ])
      await runOne.press({ key: 'toggle' })
      expect((await runOne.find({ key: 'toggle' }))?.text).toBe('▾ 2 steps')
      expect((await runOne.find({ key: `step-${steps[0]!}` }))?.text).toBe('▸ ✓ Read a.ts')
      const runOneSecond = await mount(steps[1]!, 'Read')
      expect((await runOneSecond.find({ key: `step-${steps[1]!}` }))?.text).toBe('▸ ✓ Read b.ts')
      expect((await runOneSecond.find({ key: 'label' }))?.text).toMatch(/^Claude · /)
      await runOneSecond.press({ key: `step-${steps[1]!}` })
      const openCleanResult = await $.ui.mount({
        plugin: 'lens',
        surface,
        component: 'ToolResult',
        requestId: steps[1]!,
        props: {
          tool_use_id: steps[1]!,
          tool: 'Read',
          output: { type: 'text', file: { numLines: 12 } },
          isErrored: false,
        },
      })
      expect(await openCleanResult.find({ text: 'ENGINE' })).toBeDefined()
      await openCleanResult.unmount()
      await runOne.press({ key: 'toggle' })
      const closedCleanResult = await $.ui.mount({
        plugin: 'lens',
        surface,
        component: 'ToolResult',
        requestId: steps[1]!,
        props: {
          tool_use_id: steps[1]!,
          tool: 'Read',
          output: { type: 'text', file: { numLines: 12 } },
          isErrored: false,
        },
      })
      expect(await closedCleanResult.find({ key: 'folded' })).toBeDefined()
      await closedCleanResult.unmount()
      await runOne.press({ key: 'toggle' })
      await runOneSecond.press({ key: `step-${steps[1]!}` })
      await runOne.press({ key: 'toggle' })
      await runOneSecond.unmount()

      // Run 2: the failing command and the edit; one plain error line.
      const runTwo = await mount(steps[2]!, 'Bash')
      expect((await runTwo.find({ key: 'toggle' }))?.text).toBe('▸ 2 steps · 1 failed')
      expect((await runTwo.findAll({ type: 'Text' })).map(t => t.text)).toEqual([
        '  ✗ The command failed (exit 1). Press Ctrl+O to see its output.',
        expect.stringMatching(/^Opus 5\.5 · \d\d:\d\d$/),
      ])
      expect(await runTwo.find({ text: /npm ERR|\/Users|exit 0|lines/ })).toBeUndefined()

      // Every other row of a run draws nothing.
      const folded = await mount(steps[1]!, 'Read')
      expect(await folded.find({ key: 'folded' })).toBeDefined()
      expect(await folded.find({ type: 'Text' })).toBeUndefined()
      for (const ui of [runOne, runTwo, folded]) await ui.unmount()
    }
  })

  test('normal is the default view', async ($, on) => {
    const steps = await playTurn($, engineBottom(on))
    const ui = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[0]!,
      props: toolRow(steps[0]!, 'Read', {}),
    })
    expect((await ui.find({ key: 'line' }))?.text).toBe('• Read 2 files')
  })

  test("normal lists each run's steps with one fact each", async ($, on) => {
    const steps = await playTurn($, engineBottom(on))
    await $.command.run({ command: 'lens', args: 'normal' } as never)
    const runOne = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[0]!,
      props: toolRow(steps[0]!, 'Read', {}),
    })
    expect((await runOne.find({ key: 'line' }))?.text).toBe('• Read 2 files')
    expect(await runOne.find({ key: 'toggle' })).toBeUndefined()
    expect((await runOne.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['• Read 2 files'])
    expect((await runOne.find({ key: `step-${steps[0]!}` }))?.text).toBe('▸ ✓ Read a.ts · 12 lines')
    const runOneSecond = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[1]!,
      props: toolRow(steps[1]!, 'Read', {}),
    })
    expect((await runOneSecond.find({ key: `step-${steps[1]!}` }))?.text).toBe(
      '▸ ✓ Read b.ts · 12 lines',
    )
    expect((await runOneSecond.find({ key: 'label' }))?.text).toMatch(/^Claude · /)
    const runTwo = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[2]!,
      props: toolRow(steps[2]!, 'Bash', {}),
    })
    expect((await runTwo.find({ key: 'line' }))?.text).toBe(
      '• Changed 1 file, ran 1 command (1 failed)',
    )
    expect((await runTwo.findAll({ type: 'Text' })).map(t => t.text)).toEqual([
      '• Changed 1 file, ran 1 command (1 failed)',
      '  The command failed (exit 1). Press Ctrl+O to see its output.',
      '  npm ERR! Missing script: "tset"',
    ])
    expect((await runTwo.find({ key: `step-${steps[2]!}` }))?.text).toBe(
      '▸ ✗ Run the tests · exit 1',
    )
    const editRow = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[3]!,
      props: toolRow(steps[3]!, 'Edit', {}),
    })
    expect((await editRow.find({ key: `step-${steps[3]!}` }))?.text).toBe(
      '▸ ✓ Edited a.ts · +1 −1 lines',
    )
    expect((await editRow.find({ key: 'label' }))?.text).toMatch(/^Opus 5\.5 · \d\d:\d\d$/)
  })

  test('both views show the model a sub-agent ran', async ($, on) => {
    const bottom = engineBottom(on)
    await $.command.run({ command: 'lens', args: 'normal' } as never)
    await $.turn.start({ text: 'delegate', turnId: 'turn-8' })
    await $.tool.call({ tool: 'Agent', description: 'Count lines', prompt: 'count' })
    const ui = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: bottom.ids[0]!,
      props: toolRow(bottom.ids[0]!, 'Agent', {}),
    })
    expect((await ui.find({ key: `step-${bottom.ids[0]!}` }))?.text).toBe(
      '▸ ✓ Delegated: Count lines · Haiku 5.5 · 6s',
    )
    await ui.unmount()

    // Clean shows the sub-agent's model too, and nothing else.
    await $.command.run({ command: 'lens', args: 'clean' } as never)
    const lean = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: bottom.ids[0]!,
      props: toolRow(bottom.ids[0]!, 'Agent', {}),
    })
    await lean.press({ key: 'toggle' })
    expect((await lean.find({ key: `step-${bottom.ids[0]!}` }))?.text).toBe(
      '▸ ✓ Delegated: Count lines · Haiku 5.5',
    )

    // Its "finished" row carries the model and finish time, cyan.
    const notice = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'UserMessage',
      requestId: 'n-1',
      props: {
        text: 'Agent "Count lines" finished',
        origin: { kind: 'task-notification' },
        isExpanded: false,
        task: { id: 'helper-1', toolUseId: bottom.ids[0]!, durationMs: 6200 },
      },
    })
    const label = await notice.find({ key: 'label' })
    expect(label?.text).toMatch(/^Haiku 5\.5 · \d\d:\d\d$/)
    expect((label?.children[0] as { props: Record<string, unknown> }).props).toEqual({
      color: 'cyan',
    })
  })

  test('clicking a step delegates detail to its native row', async ($, on) => {
    const steps = await playTurn($, engineBottom(on))
    await $.command.run({ command: 'lens', args: 'normal' } as never)
    const edit = `step-${steps[3]!}`
    const editRow = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[3]!,
      props: toolRow(steps[3]!, 'Edit', {}),
    })
    expect((await editRow.find({ key: edit }))?.text).toBe('▸ ✓ Edited a.ts · +1 −1 lines')
    await editRow.press({ key: edit })
    expect((await editRow.find({ key: edit }))?.text).toBe('▾ ✓ Edited a.ts · +1 −1 lines')
    expect(await editRow.find({ text: 'ENGINE' })).toBeDefined()

    const commandRow = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[2]!,
      props: toolRow(steps[2]!, 'Bash', {}),
    })
    await commandRow.press({ key: `step-${steps[2]!}` })
    expect(await commandRow.find({ text: 'ENGINE' })).toBeDefined()
  })

  test('a command opens its native detail row', async ($, on) => {
    const bottom = engineBottom(on)
    await $.turn.start({ text: 'run', turnId: 'turn-6' })
    await $.tool.call({ tool: 'Bash', command: 'echo hello', description: 'Say hello' })
    await $.tool.call({ tool: 'Bash', command: 'true # quiet', description: 'Do nothing' })
    for (const view of ['clean', 'normal'] as const) {
      await $.command.run({ command: 'lens', args: view } as never)
      const ui = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'ToolUse',
        requestId: bottom.ids[0]!,
        props: toolRow(bottom.ids[0]!, 'Bash', {}),
      })
      if (view === 'clean') await ui.press({ key: 'toggle' })
      await ui.press({ key: `step-${bottom.ids[0]!}` })
      expect(await ui.find({ text: 'ENGINE' }), view).toBeDefined()
      await ui.press({ key: `step-${bottom.ids[0]!}` })
      const quiet = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'ToolUse',
        requestId: bottom.ids[1]!,
        props: toolRow(bottom.ids[1]!, 'Bash', {}),
      })
      await quiet.press({ key: `step-${bottom.ids[1]!}` })
      expect(await quiet.find({ text: 'ENGINE' }), view).toBeDefined()
      await quiet.press({ key: `step-${bottom.ids[1]!}` })
      await quiet.unmount()
      await ui.unmount()
    }
  })

  test('normal shows 5 run steps until opened', async ($, on) => {
    const bottom = engineBottom(on)
    await $.command.run({ command: 'lens', args: 'normal' } as never)
    await $.turn.start({ text: 'read a lot', turnId: 'turn-7' })
    for (let n = 1; n <= 7; n += 1) await $.tool.call({ tool: 'Read', file_path: `/p/f${n}.ts` })
    const ui = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: bottom.ids[0]!,
      props: toolRow(bottom.ids[0]!, 'Read', {}),
    })
    expect((await ui.find({ key: 'line' }))?.text).toBe('• Read 7 files')
    expect((await ui.find({ key: `step-${bottom.ids[0]!}` }))?.text).toBe(
      '▸ ✓ Read f1.ts · 12 lines',
    )
    const fifth = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: bottom.ids[4]!,
      props: toolRow(bottom.ids[4]!, 'Read', {}),
    })
    expect((await fifth.find({ key: `step-${bottom.ids[4]!}` }))?.text).toBe(
      '▸ ✓ Read f5.ts · 12 lines',
    )
    // `+2 more` opens the run in place; `show fewer` closes it again.
    // The normal total stays informational, even for a long or expanded run.
    expect(await ui.find({ key: 'toggle' })).toBeUndefined()
    expect((await fifth.find({ key: 'more-toggle' }))?.text).toBe('+2 more')
    await fifth.press({ key: 'more-toggle' })
    expect((await fifth.find({ key: 'fewer-toggle' }))?.text).toBe('show fewer')
    const seventh = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: bottom.ids[6]!,
      props: toolRow(bottom.ids[6]!, 'Read', {}),
    })
    expect((await seventh.find({ key: `step-${bottom.ids[6]!}` }))?.text).toBe(
      '▸ ✓ Read f7.ts · 12 lines',
    )
    expect(await ui.find({ key: 'toggle' })).toBeUndefined()
    expect(await seventh.find({ key: 'more-toggle' })).toBeUndefined()
    expect(await seventh.find({ key: 'fewer-toggle' })).toBeUndefined()
    await seventh.press({ key: `step-${bottom.ids[6]!}` })
    const seventhResult = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolResult',
      requestId: bottom.ids[6]!,
      props: {
        tool_use_id: bottom.ids[6]!,
        tool: 'Read',
        output: { type: 'text', file: { numLines: 12 } },
        isErrored: false,
      },
    })
    expect(await seventhResult.find({ text: 'ENGINE' })).toBeDefined()
    await fifth.press({ key: 'fewer-toggle' })
    await seventhResult.unmount()
    const hiddenResult = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolResult',
      requestId: bottom.ids[6]!,
      props: {
        tool_use_id: bottom.ids[6]!,
        tool: 'Read',
        output: { type: 'text', file: { numLines: 12 } },
        isErrored: false,
      },
    })
    expect(await hiddenResult.find({ key: 'folded' })).toBeDefined()
    await hiddenResult.unmount()
    await seventh.unmount()
    const hiddenAgain = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: bottom.ids[6]!,
      props: toolRow(bottom.ids[6]!, 'Read', {}),
    })
    expect(await hiddenAgain.find({ key: `step-${bottom.ids[6]!}` })).toBeUndefined()
  })

  test('normal keeps the toggle stationary and shows a hidden running step', async ($, on) => {
    const bottom = engineBottom(on)
    await $.command.run({ command: 'lens', args: 'normal' } as never)
    await $.turn.start({ text: 'long run', turnId: 'turn-current-hidden' })
    for (let n = 1; n <= 5; n += 1) await $.tool.call({ tool: 'Read', file_path: `/p/f${n}.ts` })

    bottom.whileRunning = async () => {
      const first = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'ToolUse',
        requestId: bottom.ids[0]!,
        props: toolRow(bottom.ids[0]!, 'Read', {}),
      })
      expect((await first.find({ key: 'line' }))?.text).toBe('• Read 6 files · Current: Read f6.ts')
      const fifth = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'ToolUse',
        requestId: bottom.ids[4]!,
        props: toolRow(bottom.ids[4]!, 'Read', {}),
      })
      expect((await fifth.find({ key: 'more-toggle' }))?.text).toBe('+1 more')
      const hidden = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'ToolUse',
        requestId: bottom.ids[5]!,
        props: { ...toolRow(bottom.ids[5]!, 'Read', {}), isRunning: true, output: undefined },
      })
      const folded = await hidden.drawn()
      expect(folded).toMatchObject({ type: 'Box', props: { key: 'folded', display: 'none' } })
      await fifth.press({ key: 'more-toggle' })
      expect((await fifth.find({ key: 'fewer-toggle' }))?.text).toBe('show fewer')
      expect((await hidden.find({ key: `step-${bottom.ids[5]!}` }))?.text).toBe('▸ … Read f6.ts')
      expect(await hidden.find({ key: 'fewer-toggle' })).toBeUndefined()
      await fifth.press({ key: 'fewer-toggle' })
      await hidden.unmount()
      await fifth.unmount()
      await first.unmount()
      bottom.whileRunning = undefined
    }
    await $.tool.call({ tool: 'Read', file_path: '/p/f6.ts' })

    const settled = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: bottom.ids[0]!,
      props: toolRow(bottom.ids[0]!, 'Read', {}),
    })
    expect((await settled.find({ key: 'line' }))?.text).toBe('• Read 6 files')
    await settled.unmount()

    await $.tool.call({ tool: 'Bash', command: 'fail', description: 'Run failing check' })
    const failed = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: bottom.ids[0]!,
      props: toolRow(bottom.ids[0]!, 'Read', {}),
    })
    expect((await failed.find({ key: 'line' }))?.text).toBe(
      '• Read 6 files, ran 1 command (1 failed)',
    )
    const failedFifth = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: bottom.ids[4]!,
      props: toolRow(bottom.ids[4]!, 'Read', {}),
    })
    expect((await failedFifth.find({ key: 'more-toggle' }))?.text).toBe('+2 more')
    await failedFifth.unmount()
    await failed.unmount()
  })

  test('normal omits the redundant total for one-step runs', async ($, on) => {
    const bottom = engineBottom(on)
    await $.command.run({ command: 'lens', args: 'normal' } as never)
    await $.turn.start({ text: 'read one file', turnId: 'turn-single' })
    await $.tool.call({ tool: 'Read', file_path: '/p/only.ts' })
    const ui = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: bottom.ids[0]!,
      props: toolRow(bottom.ids[0]!, 'Read', {}),
    })
    expect(await ui.find({ key: 'line' })).toBeUndefined()
    expect(await ui.find({ key: 'toggle' })).toBeUndefined()
    expect((await ui.find({ key: `step-${bottom.ids[0]!}` }))?.text).toBe(
      '▸ ✓ Read only.ts · 12 lines',
    )
    expect((await ui.find({ key: 'label' }))?.text).toMatch(/^Claude · /)
  })

  test('model and time tags use cyan in normal and clean views', async ($, on) => {
    const seen: Array<{ text: string; isFirstOfReply: boolean }> = []
    let group: { isExpanded: boolean; ids: string[] } | undefined
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      seen.push({ text: e.props.text, isFirstOfReply: e.props.isFirstOfReply })
      const { Text } = $.ui.resolve(e)
      return <Text>ENGINE</Text>
    })
    on('ui.render', { component: 'ToolGroup' }, ($, e) => {
      group = {
        isExpanded: e.props.isExpanded,
        ids: e.props.calls.map(call => call.tool_use_id ?? ''),
      }
      const { Text } = $.ui.resolve(e)
      return <Text>ENGINE</Text>
    })
    const steps = await playTurn($, engineBottom(on))

    // The block keeps its own cyan label and loses the bullet.
    const block = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'AssistantMessage',
      requestId: 'reply-1',
      props: { text: 'Running the tests now.', isFirstOfReply: true },
    })
    const blockLabel = (await block.findAll({ type: 'Text' }))[1]
    expect(blockLabel?.text).toMatch(/^Opus 5\.5 · \d\d:\d\d$/)
    expect(blockLabel?.props).toMatchObject({ bold: true, color: 'cyan' })
    expect(seen.at(-1)).toEqual({ text: 'Running the tests now.', isFirstOfReply: false })

    // The run after it: cyan label, last, right-aligned, its model.
    const runTwo = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[3]!,
      props: toolRow(steps[3]!, 'Edit', {}),
    })
    const fold = await runTwo.drawn()
    // Full width, so the label lines up with the message labels on the right.
    expect(fold).toMatchObject({ type: 'Box', props: { key: 'fold', width: '100%' } })
    const children = (
      fold as {
        children: Array<{ type: string; props: Record<string, unknown>; children: unknown[] }>
      }
    ).children
    expect(children.at(-1)).toMatchObject({
      type: 'Box',
      props: { key: 'label', justifyContent: 'flex-end' },
    })
    const runLabel = await runTwo.find({ key: 'label' })
    expect((runLabel?.children[0] as { props: Record<string, unknown> }).props).toEqual({
      color: 'cyan',
    })
    await runTwo.press({ key: `step-${steps[3]!}` })
    expect(await runTwo.find({ key: 'label' })).toBeUndefined()
    const resultWithFooter = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolResult',
      requestId: steps[3]!,
      props: {
        tool_use_id: steps[3]!,
        tool: 'Edit',
        output: { structuredPatch: [{ lines: ['-x', '+y'] }] },
        isErrored: false,
      },
    })
    const resultTree = await resultWithFooter.drawn()
    expect(resultTree).toMatchObject({
      type: 'Box',
      props: { key: 'result-with-label' },
      children: [
        { type: 'Text', children: ['ENGINE'] },
        {
          type: 'Box',
          props: { key: 'label', justifyContent: 'flex-end' },
          children: [{ type: 'Text', props: { color: 'cyan' } }],
        },
      ],
    })
    await resultWithFooter.unmount()

    await $.command.run({ command: 'lens', args: 'clean' } as never)
    // A group Claude Code bundled is expanded natively, so each ToolUse site
    // decides its own Lens row and mixed known/unknown members are preserved.
    const call = (id: string, tool: string) => ({
      tool_use_id: id,
      tool,
      input: {},
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    })
    for (const isExpanded of [false, true]) {
      const g = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'ToolGroup',
        viewport: { columns: 120, rows: 40, isFullscreen: true },
        props: {
          calls: [call(steps[2]!, 'Bash'), call(steps[3]!, 'Edit'), call('unseen', 'Read')],
          isActive: false,
          isExpanded,
        },
      })
      expect(await g.find({ text: 'ENGINE' })).toBeDefined()
      await g.unmount()
    }
    expect(group).toEqual({ isExpanded: true, ids: [steps[2]!, steps[3]!, 'unseen'] })

    const cleanRun = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[2]!,
      props: toolRow(steps[2]!, 'Bash', {}),
    })
    const cleanLabel = await cleanRun.find({ key: 'label' })
    expect(cleanLabel?.text).toMatch(/^Opus 5\.5 · \d\d:\d\d$/)
    expect((cleanLabel?.children[0] as { props: Record<string, unknown> }).props).toEqual({
      color: 'cyan',
    })
    await cleanRun.unmount()
  })

  test('open grouped rows keep the run footer with inline native results', async ($, on) => {
    const steps = await playTurn($, engineBottom(on))
    await $.command.run({ command: 'lens', args: 'normal' } as never)
    const call = (id: string, tool: string) => ({
      tool_use_id: id,
      tool,
      input: {},
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output: {},
    })
    const group = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolGroup',
      viewport: { columns: 120, rows: 40, isFullscreen: true },
      props: {
        calls: [call(steps[2]!, 'Bash'), call(steps[3]!, 'Edit')],
        isActive: false,
        isExpanded: false,
      },
    })
    expect(await group.find({ text: 'ENGINE' })).toBeDefined()
    await group.unmount()

    const lastGrouped = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[3]!,
      props: toolRow(steps[3]!, 'Edit', {}),
    })
    await lastGrouped.press({ key: `step-${steps[3]!}` })
    expect(await lastGrouped.find({ text: 'ENGINE' })).toBeDefined()
    const groupedLabel = await lastGrouped.find({ key: 'label' })
    expect(groupedLabel?.text).toMatch(/^Opus 5\.5 · \d\d:\d\d$/)
    expect((groupedLabel?.children[0] as { props: Record<string, unknown> }).props).toEqual({
      color: 'cyan',
    })
  })

  test('native delegation preserves large and old details', async ($, on) => {
    let nativeToolUse: { input: unknown; output: unknown; tool_use_id: string } | undefined
    let nativeResult: unknown
    on('ui.render', { component: 'ToolUse' }, ($, e) => {
      nativeToolUse = {
        input: e.props.input,
        output: e.props.output,
        tool_use_id: e.props.tool_use_id,
      }
      const { Text } = $.ui.resolve(e)
      return <Text>NATIVE TOOL</Text>
    })
    on('ui.render', { component: 'ToolResult' }, ($, e) => {
      nativeResult = e.props.output
      const { Text } = $.ui.resolve(e)
      return <Text>NATIVE RESULT</Text>
    })
    const bottom = engineBottom(on)
    await $.command.run({ command: 'lens', args: 'normal' } as never)
    await $.turn.start({ text: 'large', turnId: 'turn-large' })
    const longCommand = `printf ${'x'.repeat(5000)}`
    await $.tool.call({ tool: 'Bash', command: longCommand, description: 'Print a lot' })
    const longOutput = {
      stdout: Array.from({ length: 2101 }, (_, n) => `${n}: ${'o'.repeat(20)}`).join('\n'),
      stderr: 'e'.repeat(25_000),
      interrupted: false,
    }
    const ui = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: bottom.ids[0]!,
      props: {
        ...toolRow(bottom.ids[0]!, 'Bash', { command: longCommand }),
        output: longOutput,
      },
    })
    await ui.press({ key: `step-${bottom.ids[0]!}` })
    expect(nativeToolUse?.input).toEqual({ command: longCommand })
    expect(nativeToolUse?.output).toEqual(longOutput)

    const closedResult = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolResult',
      requestId: 'closed-result',
      props: { tool_use_id: 'closed-result', tool: 'Bash', output: longOutput, isErrored: false },
    })
    expect(await closedResult.find({ key: 'folded' })).toBeDefined()
    expect(nativeResult).toBeUndefined()
    await closedResult.unmount()

    const result = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolResult',
      requestId: bottom.ids[0]!,
      props: { tool_use_id: bottom.ids[0]!, tool: 'Bash', output: longOutput, isErrored: false },
    })
    expect(await result.find({ text: 'NATIVE RESULT' })).toBeDefined()
    expect(nativeResult).toEqual(longOutput)
    await ui.press({ key: `step-${bottom.ids[0]!}` })
    await result.unmount()
    const collapsedResult = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolResult',
      requestId: bottom.ids[0]!,
      props: { tool_use_id: bottom.ids[0]!, tool: 'Bash', output: longOutput, isErrored: false },
    })
    expect(await collapsedResult.find({ key: 'folded' })).toBeDefined()
    await collapsedResult.unmount()

    const largePatch = {
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 250,
          newStart: 1,
          newLines: 250,
          lines: Array.from({ length: 250 }, (_, n) => (n % 2 === 0 ? `-${n}` : `+${n}`)),
        },
      ],
    }
    await $.turn.start({ text: 'diff', turnId: 'turn-diff' })
    await $.tool.call({ tool: 'Edit', file_path: '/p/large.ts', old_string: 'x', new_string: 'y' })
    const diffId = bottom.ids[1]!
    const diff = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: diffId,
      props: { ...toolRow(diffId, 'Edit', { file_path: '/p/large.ts' }), output: largePatch },
    })
    await diff.press({ key: `step-${diffId}` })
    expect(nativeToolUse?.output).toEqual(largePatch)

    const customOutput = {
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
        { type: 'button', label: 'Open details', value: 'open' },
      ],
    }
    await $.turn.start({ text: 'custom output', turnId: 'turn-custom-output' })
    await $.tool.call({ tool: 'mcp__demo__image_tool', value: 1 } as never)
    const customId = bottom.ids[2]!
    const custom = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: customId,
      props: {
        ...toolRow(customId, 'mcp__demo__image_tool', { value: 1 }),
        output: customOutput,
      },
    })
    await custom.press({ key: `step-${customId}` })
    expect(nativeToolUse?.output).toEqual(customOutput)

    const oldStart = bottom.ids.length
    await $.turn.start({ text: 'old', turnId: 'turn-old' })
    for (let n = 0; n < 601; n += 1) await $.tool.call({ tool: 'Read', file_path: `/p/${n}.ts` })
    const oldId = bottom.ids[oldStart]!
    const old = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: oldId,
      props: {
        ...toolRow(oldId, 'Read', { file_path: '/p/0.ts' }),
        output: { type: 'text', file: { numLines: 1 } },
      },
    })
    expect((await old.find({ key: `step-${oldId}` }))?.text).toBe('▸ ✓ Read 0.ts · 1 line')
    await old.press({ key: `step-${oldId}` })
    expect(await old.find({ text: 'NATIVE TOOL' })).toBeDefined()
    await diff.unmount()
    await custom.unmount()
  })

  test('collapsed read, running, custom and historical rows open native details', async ($, on) => {
    const bottom = engineBottom(on)
    await $.command.run({ command: 'lens', args: 'normal' } as never)
    bottom.whileRunning = async () => {
      const runningId = bottom.ids.at(-1)!
      const running = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'ToolUse',
        requestId: runningId,
        props: {
          ...toolRow(runningId, 'Bash', { command: 'sleep 1' }),
          isRunning: true,
          output: undefined,
        },
      })
      expect((await running.find({ key: `step-${runningId}` }))?.text).toBe('▸ … Wait briefly')
      await running.press({ key: `step-${runningId}` })
      expect(await running.find({ text: 'ENGINE' })).toBeDefined()
      expect((await running.find({ key: 'label' }))?.text).toMatch(/^Claude · \d\d:\d\d$/)
      await running.unmount()
      bottom.whileRunning = undefined
    }
    await $.turn.start({ text: 'running', turnId: 'turn-running' })
    await $.tool.call({ tool: 'Bash', command: 'sleep 1', description: 'Wait briefly' })
    const completedRunning = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: bottom.ids[0]!,
      props: toolRow(bottom.ids[0]!, 'Bash', { command: 'sleep 1' }),
    })
    expect((await completedRunning.find({ key: `step-${bottom.ids[0]!}` }))?.text).toBe(
      '▾ ✓ Wait briefly · exit 0',
    )
    expect(await completedRunning.find({ text: 'ENGINE' })).toBeDefined()

    await $.turn.start({ text: 'read', turnId: 'turn-native' })
    await $.tool.call({ tool: 'Read', file_path: '/p/native.ts' })
    const readId = bottom.ids[1]!
    const read = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: readId,
      props: toolRow(readId, 'Read', { file_path: '/p/native.ts' }),
    })
    expect((await read.find({ key: `step-${readId}` }))?.text).toBe('▸ ✓ Read native.ts · 12 lines')
    await read.press({ key: `step-${readId}` })
    expect(await read.find({ text: 'ENGINE' })).toBeDefined()

    await $.turn.start({ text: 'custom', turnId: 'turn-custom' })
    await $.tool.call({ tool: 'mcp__demo__custom_tool', value: 1 } as never)
    const customId = bottom.ids[2]!
    const custom = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: customId,
      props: toolRow(customId, 'mcp__demo__custom_tool', { value: 1 }),
    })
    expect((await custom.find({ key: `step-${customId}` }))?.text).toBe(
      '▸ ✓ Used demo: custom tool',
    )
    await custom.press({ key: `step-${customId}` })
    expect(await custom.find({ text: 'ENGINE' })).toBeDefined()

    const historical = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 'old-read',
      props: {
        ...toolRow('old-read', 'Read', { file_path: '/p/old.ts' }),
        output: { type: 'text', file: { numLines: 8 } },
      },
    })
    expect((await historical.find({ key: 'step-old-read' }))?.text).toBe(
      '▸ ✓ Read old.ts · 8 lines',
    )
    await historical.press({ key: 'step-old-read' })
    expect(await historical.find({ text: 'ENGINE' })).toBeDefined()

    const interrupted = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 'old-interrupted',
      props: {
        ...toolRow('old-interrupted', 'Bash', { command: 'sleep 10' }),
        isInterrupted: true,
        output: undefined,
      },
    })
    expect((await interrupted.find({ key: 'step-old-interrupted' }))?.text).toBe(
      '▸ ◌ Ran a shell command',
    )
    expect(await interrupted.find({ text: /exit 0/ })).toBeUndefined()
  })

  test('raw restores the engine drawing everywhere', async ($, on) => {
    const steps = await playTurn($, engineBottom(on))
    await $.command.run({ command: 'lens', args: 'raw' } as never)
    const sites = [
      { component: 'ToolUse', props: toolRow(steps[0]!, 'Read', {}) },
      {
        component: 'ToolResult',
        props: { tool_use_id: steps[0]!, tool: 'Read', output: {}, isErrored: false },
      },
      { component: 'AssistantMessage', props: { text: 'Hi', isFirstOfReply: true } },
      {
        component: 'UserMessage',
        props: { text: 'fix it', origin: { kind: 'composer' }, isExpanded: false },
      },
      {
        component: 'Spinner',
        props: { word: 'Baking', message: null, suffix: '…', mode: 'tool-use' },
      },
      {
        component: 'CommandOutput',
        props: { command: 'x', args: '', text: 'ENOENT', isErrored: true },
      },
    ] as const
    for (const site of sites) {
      const ui = await $.ui.mount({ plugin: 'lens', surface: 'terminal', ...site } as never)
      const drawn = await ui.drawn()
      expect(drawn, site.component).toMatchObject({ type: 'Text', children: ['ENGINE'] })
      await ui.unmount()
    }
    // And back: clean draws its own again.
    await $.command.run({ command: 'lens', args: 'clean' } as never)
    const back = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: steps[0]!,
      props: toolRow(steps[0]!, 'Read', {}),
    })
    expect(await back.find({ key: 'toggle' })).toBeDefined()
  })

  test('messages carry a label', async ($, on) => {
    const bottom = { lastText: '' }
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      bottom.lastText = e.props.text
      const { Text } = $.ui.resolve(e)
      return <Text>ENGINE</Text>
    })
    engineBottom(on)
    await $.session.append({
      door: 'prompt',
      uuid: 'u-1',
      origin: { kind: 'person' },
      message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'fix it' }] },
    } as never)
    const user = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'UserMessage',
      requestId: 'u-1',
      props: { text: 'fix it', origin: { kind: 'composer' }, isExpanded: false },
    })
    expect((await user.findAll({ type: 'Text' })).map(t => t.text)).toEqual([
      'ENGINE',
      expect.stringMatching(/^You · \d\d:\d\d$/),
    ])
    expect(await user.find({ text: 'ENGINE' })).toBeDefined()

    // Each reply is labeled with the model that sent it, inside its own text.
    for (const [uuid, model, text] of [
      ['r-1', 'claude-opus-5-5', 'First answer.'],
      ['r-2', 'claude-fable-5-1', 'Second answer.'],
    ] as const) {
      await $.session.append({
        door: 'response',
        uuid,
        origin: { kind: 'model', model },
        message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
      } as never)
    }
    const labels: Array<string | undefined> = []
    for (const [requestId, text] of [
      ['r-1', 'First answer.'],
      ['r-2', 'Second answer.'],
      ['r-x', 'Unseen.'],
    ] as const) {
      const reply = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'AssistantMessage',
        requestId,
        props: { text, isFirstOfReply: true },
      })
      // The engine's drawing first, the label under it; the text untouched.
      const drawn = await reply.drawn()
      expect(drawn).toMatchObject({
        type: 'Box',
        children: [
          { type: 'Text', children: ['ENGINE'] },
          { type: 'Box', props: { justifyContent: 'flex-end' } },
        ],
      })
      expect(bottom.lastText).toBe(text)
      labels.push((await reply.findAll({ type: 'Text' }))[1]?.text)
      await reply.unmount()
    }
    expect(labels[0]).toMatch(/^Opus 5\.5 · \d\d:\d\d$/)
    expect(labels[1]).toMatch(/^Fable 5\.1 · \d\d:\d\d$/)
    expect(labels[2]).toBe('Claude')
    await user.unmount()

    // Ctrl+O: an expanded user row passes through untouched.
    const full = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'UserMessage',
      requestId: 'u-1',
      props: { text: 'fix it', origin: { kind: 'composer' }, isExpanded: true },
    })
    expect(await full.drawn()).toMatchObject({ type: 'Text', children: ['ENGINE'] })
    // While that view is open, tool rows pass through too.
    const inTranscript = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 't-x',
      props: toolRow('t-x', 'Read', {}),
    })
    expect(await inTranscript.drawn()).toMatchObject({ type: 'Text', children: ['ENGINE'] })
    await full.unmount()
    // Back in the chat, a compact user row closes that window.
    await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'UserMessage',
      requestId: 'u-1',
      props: { text: 'fix it', origin: { kind: 'composer' }, isExpanded: false },
    })
  })

  test('question transcript rows use chevrons and delegate native details', async ($, on) => {
    engineBottom(on)
    const answeredOutput = {
      questions: [{ header: 'Scope', question: 'Which scope?' }],
      answers: { 'Which scope?': 'User' },
    }
    for (const view of ['normal', 'clean'] as const) {
      await $.command.run({ command: 'lens', args: view } as never)
      const question = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'ToolUse',
        requestId: `q-${view}`,
        props: { ...toolRow(`q-${view}`, 'AskUserQuestion', {}), output: answeredOutput },
      })
      expect((await question.find({ key: 'question-toggle' }))?.text).toBe(
        '▸ ? Answered Scope: User',
      )
      const closedQuestionResult = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'ToolResult',
        requestId: `q-${view}`,
        props: {
          tool_use_id: `q-${view}`,
          tool: 'AskUserQuestion',
          output: { response: 'User' },
          isErrored: false,
        },
      })
      expect(await closedQuestionResult.find({ key: 'folded' })).toBeDefined()
      await closedQuestionResult.unmount()

      await question.press({ key: 'question-toggle' })
      expect((await question.find({ key: 'question-toggle' }))?.text).toBe(
        '▾ ? Answered Scope: User',
      )
      expect((await question.findAll({ type: 'Text' })).map(t => t.text)).toEqual([
        'Scope: Which scope?',
        '→ User',
        'ENGINE',
      ])
      const openQuestionResult = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'ToolResult',
        requestId: `q-${view}`,
        props: {
          tool_use_id: `q-${view}`,
          tool: 'AskUserQuestion',
          output: { response: 'User' },
          isErrored: false,
        },
      })
      expect(await openQuestionResult.find({ text: 'ENGINE' })).toBeDefined()
      await openQuestionResult.unmount()
      await question.unmount()
    }
  })

  test('waiting skipped and error questions keep native contents when opened', async ($, on) => {
    engineBottom(on)
    for (const props of [
      {
        ...toolRow('q-waiting', 'AskUserQuestion', {
          questions: [{ header: 'Scope', question: 'Which scope?' }],
        }),
        isRunning: true,
        output: undefined,
        expected: '▸ ? Waiting for your answer…',
      },
      {
        ...toolRow('q-skipped', 'AskUserQuestion', {
          questions: [{ header: 'Scope', question: 'Which scope?' }],
        }),
        output: undefined,
        expected: '▸ ? Question skipped. The step failed. Press Ctrl+O to see the details.',
      },
      {
        ...toolRow('q-error', 'AskUserQuestion', {
          questions: [{ header: 'Scope', question: 'Which scope?' }],
        }),
        isErrored: true,
        output: 'permission denied',
        expected:
          '▸ ? Question skipped. Permission denied. Check file permissions or run with access.',
      },
    ]) {
      const question = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'ToolUse',
        requestId: props.tool_use_id,
        props,
      })
      expect((await question.find({ key: 'question-toggle' }))?.text).toBe(props.expected)
      expect(await question.find({ text: /→|Scope: Which scope/ })).toBeUndefined()
      await question.press({ key: 'question-toggle' })
      expect((await question.find({ key: 'question-toggle' }))?.text).toBe(
        props.expected.replace('▸', '▾'),
      )
      expect(await question.find({ text: 'ENGINE' })).toBeDefined()
      expect(await question.find({ text: /→|Scope: Which scope/ })).toBeUndefined()
      const result = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'ToolResult',
        requestId: props.tool_use_id,
        props: {
          tool_use_id: props.tool_use_id,
          tool: 'AskUserQuestion',
          output: props.output,
          isErrored: props.isErrored,
        },
      })
      expect(await result.find({ text: 'ENGINE' })).toBeDefined()
      await result.unmount()
      await question.unmount()
    }
  })

  test('the native AskUserQuestion dialog and raw view pass through untouched', async ($, on) => {
    engineBottom(on)
    let dialogError = ''
    try {
      await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'AskUserQuestion',
        props: {
          tool: 'AskUserQuestion',
          questions: [{ header: 'Scope', question: 'Which scope?' }],
        },
      })
    } catch (error) {
      dialogError = String(error)
    }
    expect(dialogError).toContain('the engine drew its own')

    await $.command.run({ command: 'lens', args: 'raw' } as never)
    const rawQuestion = await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'ToolUse',
      requestId: 'q-raw',
      props: {
        ...toolRow('q-raw', 'AskUserQuestion', {}),
        output: { response: 'User' },
      },
    })
    expect(await rawQuestion.drawn()).toMatchObject({ type: 'Text', children: ['ENGINE'] })
  })

  test('the spinner shows the current step; command errors are relabeled', async ($, on) => {
    let seen: string | null = null
    let text = ''
    on('ui.render', { component: 'Spinner' }, ($, e) => {
      seen = e.props.message
      const { Text } = $.ui.resolve(e)
      return <Text>ENGINE</Text>
    })
    on('ui.render', { component: 'CommandOutput' }, ($, e) => {
      text = e.props.text
      const { Text } = $.ui.resolve(e)
      return <Text>ENGINE</Text>
    })
    const bottom = engineBottom(on)
    bottom.whileRunning = async () => {
      const ui = await $.ui.mount({
        plugin: 'lens',
        surface: 'terminal',
        component: 'Spinner',
        props: { word: 'Baking', message: null, suffix: '…', mode: 'tool-use' },
      })
      await ui.unmount()
    }
    await $.turn.start({ text: 'go', turnId: 'turn-9' })
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests' })
    expect(seen).toBe('Run the tests')

    await $.ui.mount({
      plugin: 'lens',
      surface: 'terminal',
      component: 'CommandOutput',
      props: {
        command: 'x',
        args: '',
        text: 'Error: EACCES: permission denied, open /etc/x',
        isErrored: true,
      },
    })
    expect(text).toBe('Permission denied. Check file permissions or run with access.')
  })
})

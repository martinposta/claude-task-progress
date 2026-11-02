import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'task-progress',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const PLAN = 'mcp__ccd_turn__update_plan'

test('the band follows the desktop task list', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  let now = 0
  on('clock.now', () => ({ value: (now += 60_000) }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.turn.start({ text: '', turnId: 't1' })

  await $.tool.call({
    tool: PLAN,
    items: [
      { content: 'Read the code', status: 'in_progress' },
      { content: 'Write the fix', status: 'pending' },
      { content: 'Run the tests', status: 'pending' },
      { content: 'Ship it', status: 'pending' },
    ],
  })
  await $.tool.call({ tool: PLAN, advance: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /1\/4/ }))?.text).toContain('1/4')
    expect((await ui.find({ type: 'Text', text: /Write the fix/ }))?.text).toBe('Write the fix')
    expect(await ui.find({ type: 'Text', text: /left/ })).toBeDefined()
    await ui.unmount()
  }
})

test('TodoWrite lists and subagent calls', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  let now = 0
  on('clock.now', () => ({ value: (now += 60_000) }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.turn.start({ text: '', turnId: 't1' })

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'A', status: 'completed', activeForm: 'A' },
      { content: 'B', status: 'in_progress', activeForm: 'B' },
    ],
  })
  // A subagent's own list does not replace the main one.
  await $.tool.call({
    tool: 'TodoWrite',
    agentId: 'sub',
    todos: [{ content: 'Z', status: 'pending', activeForm: 'Z' }],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /1\/2/ }))?.text).toContain('1/2')
  expect((await ui.find({ type: 'Text', text: /^B$/ }))?.text).toBe('B')
  await ui.unmount()
})

test('no task list, no band', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, 'engine') as never
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('a turn with no task list shows the working sweep', async ($, on) => {
  let now = 0
  on('clock.now', () => ({ value: (now += 1_000) }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.turn.start({ text: '', turnId: 't1' })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Working/ }))?.text).toContain('Working')
  await ui.unmount()
})

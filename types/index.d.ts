export type LensView = 'clean' | 'normal' | 'raw'

export type LensStatus = 'running' | 'ok' | 'error' | 'interrupted'

export type LensStep = {
  id: string
  turn: string
  run: number
  tool: string
  label: string
  kind: string
  status: LensStatus
  error?: string
  /** One short fact from the step's result (`exit 0`, `34 lines`). */
  detail?: string
  /** The raw error's first line, paths shortened; normal view only. */
  rawError?: string
  /** When the step started, and the model whose reply called it. */
  at?: number
  model?: string
  /** A sub-agent step: the agent it started, and the model that agent ran. */
  agentId?: string
  agentModel?: string
}

export type LensCursor = {
  turn: string
  run: number
  sawText: boolean
  /** The model of the latest reply row, which calls the next steps. */
  model?: string
}

export type LensStamp = {
  id: string
  key: string
  at: number
  model?: string
}

declare module 'claude-code' {
  interface PluginState {
    lens: {
      view: LensView
      steps: LensStep[]
      cursor: LensCursor
      current: string | null
      expanded: string[]
      stamps: LensStamp[]
      tzOffset: number | null
    }
  }
}

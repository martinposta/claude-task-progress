export type StepStatus = 'pending' | 'in_progress' | 'completed'

export type Step = { key: string; subject: string; status: StepStatus }

export type Plan = {
  steps: Step[]
  // When the first step of this plan was seen.
  startedAt: number
  // When the current step began (the last status change).
  stepStartedAt: number
  // How long each completed step took, in ms.
  durations: number[]
}

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { plan: Plan | null; isHidden: boolean; turnStartedAt: number | null }
  }
}

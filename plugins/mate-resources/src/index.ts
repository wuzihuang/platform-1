import type { Resources } from '@hcengineering/platform'
import AgentRuntimeWidget from './components/AgentRuntimeWidget.svelte'
import AiTeammatesSettings from './components/AiTeammatesSettings.svelte'

export default async (): Promise<Resources> => ({
  component: {
    AgentRuntimeWidget,
    AiTeammatesSettings
  }
})

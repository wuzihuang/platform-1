import { getMetadata } from '@hcengineering/platform'
import type { TriggerControl } from '@hcengineering/server-core'
import serverMate from '@hcengineering/server-mate'

export function hasMateEndpoint (): boolean {
  return (getMetadata(serverMate.metadata.OrchestratorURL) ?? '') !== ''
}

export async function postOrchestrator (path: string, body: unknown, control: TriggerControl): Promise<void> {
  const base = (getMetadata(serverMate.metadata.OrchestratorURL) ?? '').replace(/\/$/, '')
  if (base === '') return
  const secret = getMetadata(serverMate.metadata.OrchestratorSecret) ?? ''
  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        'Idempotency-Key':
          typeof body === 'object' && body !== null && 'eventId' in body
            ? String((body as { eventId: unknown }).eventId)
            : ''
      },
      body: JSON.stringify(body)
    })
    if (!response.ok) {
      control.ctx.error('Mate orchestrator rejected event', { path, status: response.status })
    }
  } catch (error) {
    control.ctx.error('Could not send Mate orchestrator event', { path, error })
  }
}

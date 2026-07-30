<script lang="ts">
  import { onMount } from 'svelte'
  import core, { getCurrentAccount } from '@hcengineering/core'
  import type { BrainProfile, HarnessProfile, Mate, MateIdentity } from '@hcengineering/mate'
  import { getMetadata } from '@hcengineering/platform'
  import presentation, { createQuery, getClient, getCurrentWorkspaceUuid } from '@hcengineering/presentation'
  import { Button, Label } from '@hcengineering/ui'
  import workbench, { type Widget } from '@hcengineering/workbench'
  import { openWidget } from '@hcengineering/workbench-resources'
  import mate from '../plugin'

  interface RuntimeStatus {
    state: 'idle' | 'running' | 'error' | 'offline'
    runnerId?: string
    lastSeen?: string
    error?: string
    adapters?: Record<string, string>
  }

  interface RuntimeMateConfig {
    mateId: string
    credentialReady: boolean
    status: RuntimeStatus
  }

  interface Draft {
    provider: string
    brainModel: string
    authType: 'api-key' | 'oauth'
    harness: string
    harnessModel: string
    effort: 'low' | 'medium' | 'high'
    credential: string
    credentialRef?: string
    saving: boolean
    message: string
    error: string
  }

  const mateQuery = createQuery()
  const identityQuery = createQuery()
  const brainQuery = createQuery()
  const harnessQuery = createQuery()
  let mates: Mate[] = []
  let identities: MateIdentity[] = []
  let brains: BrainProfile[] = []
  let harnesses: HarnessProfile[] = []
  let runtimeConfigs: RuntimeMateConfig[] = []
  let drafts: Record<string, Draft> = {}
  let pageError = ''
  let matesLoaded = false
  let brainsLoaded = false
  let harnessesLoaded = false

  const baseUrl = (getMetadata(mate.metadata.OrchestratorURL) ?? '').replace(/\/$/, '')
  const authToken = getMetadata(presentation.metadata.Token) ?? ''
  const workspaceId = getCurrentWorkspaceUuid()

  mateQuery.query(mate.class.Mate, {}, (result) => {
    mates = result
    matesLoaded = true
  })
  identityQuery.query(mate.class.MateIdentity, {}, (result) => {
    identities = result
  })
  brainQuery.query(mate.class.BrainProfile, {}, (result) => {
    brains = result
    brainsLoaded = true
  })
  harnessQuery.query(mate.class.HarnessProfile, {}, (result) => {
    harnesses = result
    harnessesLoaded = true
  })

  function syncDrafts (): void {
    const next = { ...drafts }
    for (const teammate of mates) {
      if (next[teammate._id] !== undefined) continue
      const brain = brains.find((item) => item.mate === teammate._id)
      const harness = harnesses.find((item) => item.mate === teammate._id)
      next[teammate._id] = {
        provider: brain?.provider ?? 'openai',
        brainModel: brain?.model ?? 'gpt-5.6-sol',
        authType: brain?.authType ?? 'api-key',
        harness: harness?.harness ?? 'codex',
        harnessModel: harness?.model ?? brain?.model ?? 'gpt-5.6-sol',
        effort: (harness?.effort as Draft['effort']) ?? 'medium',
        credential: '',
        credentialRef: brain?.credentialRef ?? harness?.credentialRef,
        saving: false,
        message: '',
        error: ''
      }
    }
    drafts = next
  }

  $: if (matesLoaded && brainsLoaded && harnessesLoaded) syncDrafts()

  function identityFor (value: Mate): MateIdentity | undefined {
    return identities.find((identity) => identity.mate === value._id)
  }

  function runtimeFor (value: Mate): RuntimeMateConfig | undefined {
    return runtimeConfigs.find((item) => item.mateId === value._id)
  }

  function fieldValue (event: Event): string {
    return (event.currentTarget as HTMLInputElement | HTMLSelectElement).value
  }

  function authTypeValue (event: Event): Draft['authType'] {
    return fieldValue(event) === 'oauth' ? 'oauth' : 'api-key'
  }

  function effortValue (event: Event): Draft['effort'] {
    const value = fieldValue(event)
    return value === 'low' || value === 'high' ? value : 'medium'
  }

  function updateDraft<K extends keyof Draft> (mateId: string, field: K, value: Draft[K]): void {
    const draft = drafts[mateId]
    if (draft === undefined) return
    draft[field] = value
    drafts = { ...drafts }
  }

  async function api<T> (path: string, init?: RequestInit): Promise<T> {
    if (baseUrl === '') throw new Error('Mate orchestrator URL is not configured')
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {})
      }
    })
    const value = (await response.json()) as { error?: string } & T
    if (!response.ok) throw new Error(value.error ?? `Mate request failed (${response.status})`)
    return value
  }

  async function refreshRuntime (): Promise<void> {
    try {
      const response = await api<{ items: RuntimeMateConfig[] }>(
        `/v1/mates/config?workspaceId=${encodeURIComponent(workspaceId)}`
      )
      runtimeConfigs = response.items
      pageError = ''
    } catch (error) {
      pageError = error instanceof Error ? error.message : String(error)
    }
  }

  async function saveProfile (teammate: Mate): Promise<void> {
    const draft = drafts[teammate._id]
    const runtime = runtimeFor(teammate)
    if (draft === undefined) return
    draft.saving = true
    draft.message = ''
    draft.error = ''
    drafts = { ...drafts }
    try {
      const response = await api<{
        brain: {
          provider: string
          model: string
          authType: 'api-key' | 'oauth'
          credentialRef: string
        }
        harness: {
          harness: string
          model: string
          effort: string
          allowedRoots: string[]
          credentialRef: string
        }
      }>(`/v1/mates/${encodeURIComponent(teammate._id)}/config`, {
        method: 'PUT',
        body: JSON.stringify({
          workspaceId,
          actorAccountId: getCurrentAccount().uuid,
          brain: {
            provider: draft.provider,
            model: draft.brainModel,
            authType: draft.authType,
            credentialRef: draft.credentialRef
          },
          harness: {
            harness: draft.harness,
            model: draft.harnessModel,
            effort: draft.effort,
            allowedRoots: ['/worktrees'],
            credentialRef: draft.credentialRef
          },
          ...(draft.credential !== '' ? { credential: { secret: draft.credential } } : {})
        })
      })

      const client = getClient()
      const currentBrain = brains.find((item) => item.mate === teammate._id)
      const brainData = {
        mate: teammate._id,
        provider: response.brain.provider,
        model: response.brain.model,
        authType: response.brain.authType,
        credentialRef: response.brain.credentialRef
      }
      if (currentBrain === undefined) {
        await client.createDoc(mate.class.BrainProfile, core.space.Workspace, brainData)
      } else {
        await client.updateDoc(currentBrain._class, currentBrain.space, currentBrain._id, brainData)
      }
      const currentHarness = harnesses.find((item) => item.mate === teammate._id)
      const harnessData = {
        mate: teammate._id,
        harness: response.harness.harness,
        model: response.harness.model,
        effort: response.harness.effort,
        allowedRoots: response.harness.allowedRoots,
        credentialRef: response.harness.credentialRef
      }
      if (currentHarness === undefined) {
        await client.createDoc(mate.class.HarnessProfile, core.space.Workspace, harnessData)
      } else {
        await client.updateDoc(currentHarness._class, currentHarness.space, currentHarness._id, harnessData)
      }
      draft.credentialRef = response.brain.credentialRef
      draft.credential = ''
      draft.message = 'Saved to Huly and applied to the Runner vault.'
      await refreshRuntime()
    } catch (error) {
      draft.error = error instanceof Error ? error.message : String(error)
    } finally {
      draft.saving = false
      drafts = { ...drafts }
    }
  }

  function showRuntime (): void {
    const widget = getClient().getModel().findAllSync<Widget>(workbench.class.Widget, {
      _id: mate.ids.AgentRuntimeWidget
    })[0]
    if (widget !== undefined) {
      openWidget(widget, { active: true }, { active: true, openedByUser: true })
    }
  }

  onMount(() => {
    void refreshRuntime()
  })
</script>

<div class="mate-settings">
  <header>
    <div>
      <h2><Label label={mate.string.AiTeammates} /></h2>
      <p>Secrets are relayed to the Runner vault. Huly stores only credential references.</p>
    </div>
    <Button label={mate.string.AgentRuntime} kind="primary" on:click={showRuntime} />
  </header>

  {#if pageError !== ''}
    <div class="page-error">{pageError}</div>
  {/if}

  <div class="mate-list">
    {#each mates as teammate}
      {@const identity = identityFor(teammate)}
      {@const runtime = runtimeFor(teammate)}
      {@const draft = drafts[teammate._id]}
      {#if draft !== undefined}
        <article>
          <div class="teammate-head">
            <div class="avatar">{teammate.role === 'first' ? '1M' : '2M'}</div>
            <div class="details">
              <strong>{teammate.name}</strong>
              <span>{teammate.role === 'first' ? 'First Mate' : 'Second Mate'}</span>
            </div>
            <div class="states">
              <span class:ready={identity !== undefined} class="state">
                {identity !== undefined ? 'Contact ready' : 'Provisioning contact'}
              </span>
              <span class:running={runtime?.status.state === 'running'} class:error={runtime?.status.state === 'error'}>
                {runtime?.status.state ?? 'offline'}
              </span>
            </div>
          </div>

          <div class="form-grid">
            <label>
              Brain provider
              <select
                value={draft.provider}
                on:change={(event) => updateDraft(teammate._id, 'provider', fieldValue(event))}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Google</option>
                <option value="xai">xAI</option>
                <option value="moonshot">Moonshot</option>
                <option value="oauth">OAuth provider</option>
              </select>
            </label>
            <label>
              Brain model
              <input
                value={draft.brainModel}
                on:input={(event) => updateDraft(teammate._id, 'brainModel', fieldValue(event))}
                placeholder="Model ID"
              />
            </label>
            <label>
              Credential type
              <select
                value={draft.authType}
                on:change={(event) => updateDraft(teammate._id, 'authType', authTypeValue(event))}
              >
                <option value="api-key">API key</option>
                <option value="oauth">OAuth token (skeleton)</option>
              </select>
            </label>
            <label>
              {draft.authType === 'oauth' ? 'OAuth access token' : 'API key'}
              <input
                type="password"
                autocomplete="off"
                value={draft.credential}
                on:input={(event) => updateDraft(teammate._id, 'credential', fieldValue(event))}
                placeholder={runtime?.credentialReady === true ? 'Leave blank to keep current credential' : 'Required'}
              />
            </label>
            <label>
              Harness
              <select
                value={draft.harness}
                on:change={(event) => updateDraft(teammate._id, 'harness', fieldValue(event))}
              >
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
                <option value="pi">Pi</option>
                <option value="kimi">Kimi adapter</option>
                <option value="grok">Grok adapter</option>
              </select>
            </label>
            <label>
              Harness model
              <input
                value={draft.harnessModel}
                on:input={(event) => updateDraft(teammate._id, 'harnessModel', fieldValue(event))}
                placeholder="Harness model override"
              />
            </label>
            <label>
              Effort
              <select
                value={draft.effort}
                on:change={(event) => updateDraft(teammate._id, 'effort', effortValue(event))}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <div class="adapter">
              Adapter:
              <code>{runtime?.status.adapters?.[`harness.${draft.harness}`] ?? 'runner offline'}</code>
              {#if runtime?.status.lastSeen !== undefined}
                <small>Last seen {new Date(runtime.status.lastSeen).toLocaleString()}</small>
              {/if}
            </div>
          </div>

          <div class="actions">
            <span class="message">{draft.message}</span>
            <span class="error-message">{draft.error}</span>
            <button disabled={draft.saving || identity === undefined} on:click={() => saveProfile(teammate)}>
              {draft.saving ? 'Saving…' : 'Save configuration'}
            </button>
          </div>
        </article>
      {/if}
    {/each}
  </div>
</div>

<style lang="scss">
  .mate-settings {
    padding: 1.5rem;
    max-width: 68rem;
  }
  header,
  .teammate-head,
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  header {
    margin-bottom: 1.5rem;
  }
  h2,
  p {
    margin: 0;
  }
  p,
  .details span,
  small {
    color: var(--theme-dark-color);
  }
  .mate-list {
    display: grid;
    gap: 1rem;
  }
  article {
    padding: 1rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.75rem;
    background: var(--theme-panel-color);
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 0.75rem;
    color: white;
    background: var(--primary-button-default);
    font-weight: 700;
  }
  .details {
    display: flex;
    flex: 1;
    flex-direction: column;
  }
  .states {
    display: flex;
    gap: 0.75rem;
  }
  .state {
    color: var(--warning-color);
  }
  .state.ready,
  .message,
  .running {
    color: var(--positive-color);
  }
  .error,
  .error-message,
  .page-error {
    color: var(--error-color);
  }
  .page-error {
    margin-bottom: 1rem;
  }
  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    margin-top: 1rem;
  }
  label,
  .adapter {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.8rem;
  }
  input,
  select {
    min-width: 0;
    padding: 0.45rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.35rem;
    background: var(--theme-bg-color);
    color: var(--theme-caption-color);
  }
  .adapter code {
    overflow-wrap: anywhere;
  }
  .actions {
    margin-top: 1rem;
  }
  .actions .message {
    margin-right: auto;
  }
  button {
    padding: 0.5rem 0.75rem;
  }
  @media (max-width: 48rem) {
    .form-grid {
      grid-template-columns: 1fr;
    }
  }
</style>

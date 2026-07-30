<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
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

  interface DetectedHarness {
    id: string
    label: string
    binary: string
    version?: string
  }

  interface OAuthProvider {
    id: string
    label: string
    status: string
    description?: string
  }

  interface OAuthSession {
    sessionId: string
    status: 'pending' | 'connected' | 'failed' | 'expired'
    authorizationUrl?: string
    userCode?: string
    credentialRef?: string
    provider?: string
    error?: string
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
    connecting: boolean
    checkingOAuth: boolean
    oauthSessionId?: string
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
  let detectedHarnesses: DetectedHarness[] = []
  let oauthProviders: OAuthProvider[] = []
  let drafts: Record<string, Draft> = {}
  let pageError = ''
  let harnessError = ''
  let detectingHarnesses = true
  let oauthProvidersLoaded = false
  let matesLoaded = false
  let brainsLoaded = false
  let harnessesLoaded = false
  const oauthPollers = new Map<string, ReturnType<typeof setInterval>>()
  const oauthPopups = new Map<string, Window>()

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
        connecting: false,
        checkingOAuth: false,
        message: '',
        error: ''
      }
    }
    drafts = next
  }

  $: if (matesLoaded && brainsLoaded && harnessesLoaded) syncDrafts()
  $: if (!detectingHarnesses && detectedHarnesses.length > 0 && Object.keys(drafts).length > 0) {
    selectDetectedHarnesses()
  }

  function identityFor (value: Mate): MateIdentity | undefined {
    return identities.find((identity) => identity.mate === value._id)
  }

  function runtimeFor (value: Mate): RuntimeMateConfig | undefined {
    return runtimeConfigs.find((item) => item.mateId === value._id)
  }

  function fieldValue (event: Event): string {
    return (event.currentTarget as HTMLInputElement | HTMLSelectElement).value
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

  function normalizeDetectedHarnesses (value: unknown): DetectedHarness[] {
    if (!Array.isArray(value)) return []
    return value.flatMap((item) => {
      if (typeof item === 'string') {
        return [{ id: item, label: item, binary: item }]
      }
      if (typeof item !== 'object' || item === null) return []
      const candidate = item as Record<string, unknown>
      const id = String(candidate.id ?? candidate.harness ?? candidate.name ?? '')
      if (id === '' || candidate.available === false) return []
      return [{
        id,
        label: String(candidate.label ?? id),
        binary: String(candidate.binary ?? id),
        ...(typeof candidate.version === 'string' ? { version: candidate.version } : {})
      }]
    })
  }

  function selectDetectedHarnesses (): void {
    if (detectedHarnesses.length === 0) return
    let changed = false
    for (const draft of Object.values(drafts)) {
      if (!detectedHarnesses.some((item) => item.id === draft.harness)) {
        draft.harness = detectedHarnesses[0].id
        changed = true
      }
    }
    if (changed) drafts = { ...drafts }
  }

  async function detectHarnesses (): Promise<void> {
    detectingHarnesses = true
    harnessError = ''
    try {
      const response = await api<{ harnesses?: unknown[], items?: unknown[] }>(
        `/v1/harnesses/detect?refresh=1&workspaceId=${encodeURIComponent(workspaceId)}`
      )
      detectedHarnesses = normalizeDetectedHarnesses(response.harnesses ?? response.items)
      selectDetectedHarnesses()
    } catch (error) {
      detectedHarnesses = []
      harnessError = error instanceof Error ? error.message : String(error)
    } finally {
      detectingHarnesses = false
    }
  }

  async function refreshOAuthProviders (): Promise<void> {
    try {
      const response = await api<{ providers: OAuthProvider[] }>('/v1/oauth/providers')
      oauthProviders = response.providers.filter((provider) => provider.status !== 'unavailable')
    } catch (error) {
      pageError = error instanceof Error ? error.message : String(error)
    } finally {
      oauthProvidersLoaded = true
    }
  }

  function oauthProviderFor (draft: Draft): OAuthProvider | undefined {
    return oauthProviders.find((provider) =>
      provider.id.toLowerCase().includes(draft.harness.toLowerCase())
    )
  }

  async function persistProfileReference (teammate: Mate, draft: Draft, credentialRef: string): Promise<void> {
    const client = getClient()
    const currentBrain = brains.find((item) => item.mate === teammate._id)
    const brainData = {
      mate: teammate._id,
      provider: draft.provider,
      model: draft.brainModel,
      authType: 'oauth' as const,
      credentialRef
    }
    if (currentBrain === undefined) {
      await client.createDoc(mate.class.BrainProfile, core.space.Workspace, brainData)
    } else {
      await client.updateDoc(currentBrain._class, currentBrain.space, currentBrain._id, brainData)
    }
    const currentHarness = harnesses.find((item) => item.mate === teammate._id)
    const harnessData = {
      mate: teammate._id,
      harness: draft.harness,
      model: draft.harnessModel,
      effort: draft.effort,
      allowedRoots: ['/worktrees'],
      credentialRef
    }
    if (currentHarness === undefined) {
      await client.createDoc(mate.class.HarnessProfile, core.space.Workspace, harnessData)
    } else {
      await client.updateDoc(currentHarness._class, currentHarness.space, currentHarness._id, harnessData)
    }
  }

  function stopOAuthPolling (mateId: string): void {
    const poller = oauthPollers.get(mateId)
    if (poller !== undefined) clearInterval(poller)
    oauthPollers.delete(mateId)
  }

  function openOAuthAuthorization (mateId: string, session: OAuthSession): void {
    const popup = oauthPopups.get(mateId)
    if (popup === undefined || session.authorizationUrl === undefined) return
    popup.location.href = session.authorizationUrl
    oauthPopups.delete(mateId)
  }

  async function checkOAuthSession (teammate: Mate): Promise<void> {
    const draft = drafts[teammate._id]
    if (draft?.oauthSessionId === undefined || draft.checkingOAuth) return
    draft.checkingOAuth = true
    try {
      const session = await api<OAuthSession>(
        `/v1/oauth/sessions/${encodeURIComponent(draft.oauthSessionId)}`
      )
      openOAuthAuthorization(teammate._id, session)
      if (session.userCode !== undefined) draft.message = `授权码：${session.userCode}`
      if (session.status === 'pending') {
        drafts = { ...drafts }
        return
      }
      stopOAuthPolling(teammate._id)
      draft.connecting = false
      if (session.status !== 'connected' || session.credentialRef === undefined) {
        oauthPopups.get(teammate._id)?.close()
        oauthPopups.delete(teammate._id)
        draft.error = session.error ?? `OAuth session ${session.status}`
        drafts = { ...drafts }
        return
      }
      if (!session.credentialRef.startsWith('vault://')) {
        throw new Error('OAuth completed without a vault credential reference')
      }
      draft.authType = 'oauth'
      draft.credentialRef = session.credentialRef
      draft.credential = ''
      if (session.provider !== undefined) draft.provider = session.provider
      await persistProfileReference(teammate, draft, session.credentialRef)
      draft.message = 'Connected. Huly stored only the Runner vault reference.'
      draft.error = ''
      await refreshRuntime()
    } catch (error) {
      stopOAuthPolling(teammate._id)
      draft.connecting = false
      draft.error = error instanceof Error ? error.message : String(error)
    } finally {
      draft.checkingOAuth = false
      drafts = { ...drafts }
    }
  }

  async function connectOAuth (teammate: Mate): Promise<void> {
    const draft = drafts[teammate._id]
    if (draft === undefined) return
    const provider = oauthProviderFor(draft)
    if (provider === undefined) {
      draft.error = 'No OAuth provider is available'
      drafts = { ...drafts }
      return
    }
    const popup = window.open('', `mate-oauth-${teammate._id}`, 'popup,width=560,height=760')
    if (popup === null) {
      draft.error = 'Allow pop-ups to open the official login flow'
      drafts = { ...drafts }
      return
    }
    popup.document.title = provider.label
    popup.document.body.textContent = '正在打开官方登录页面…'
    oauthPopups.set(teammate._id, popup)
    draft.connecting = true
    draft.provider = 'openai'
    draft.message = ''
    draft.error = ''
    drafts = { ...drafts }
    try {
      const session = await api<OAuthSession>('/v1/oauth/sessions', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          mateId: teammate._id,
          actorAccountId: getCurrentAccount().uuid,
          providerId: provider.id,
          brain: {
            provider: draft.provider,
            model: draft.brainModel
          },
          harness: {
            harness: draft.harness,
            model: draft.harnessModel,
            effort: draft.effort
          }
        })
      })
      draft.oauthSessionId = session.sessionId
      openOAuthAuthorization(teammate._id, session)
      if (session.userCode !== undefined) draft.message = `授权码：${session.userCode}`
      stopOAuthPolling(teammate._id)
      oauthPollers.set(teammate._id, setInterval(() => {
        void checkOAuthSession(teammate)
      }, 1500))
      void checkOAuthSession(teammate)
    } catch (error) {
      popup.close()
      oauthPopups.delete(teammate._id)
      draft.connecting = false
      draft.error = error instanceof Error ? error.message : String(error)
      drafts = { ...drafts }
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
    void detectHarnesses()
    void refreshOAuthProviders()
  })

  onDestroy(() => {
    for (const poller of oauthPollers.values()) clearInterval(poller)
    oauthPollers.clear()
    oauthPopups.clear()
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

  <section class="harness-detection" aria-live="polite">
    <div>
      <strong>Harness</strong>
      {#if detectingHarnesses}
        <span>正在检测 harness…</span>
      {:else if detectedHarnesses.length === 0}
        <span class="empty-harness">未检测到 harness</span>
      {:else}
        <div class="harness-list">
          {#each detectedHarnesses as harness}
            <span class="harness-chip">
              {harness.label}
              <code>{harness.binary}{harness.version !== undefined ? ` · ${harness.version}` : ''}</code>
            </span>
          {/each}
        </div>
      {/if}
      {#if harnessError !== ''}
        <small class="error-message">{harnessError}</small>
      {/if}
    </div>
    <button disabled={detectingHarnesses} on:click={() => detectHarnesses()}>
      {detectingHarnesses ? '检测中…' : '重新检测'}
    </button>
  </section>

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
            <div class="oauth-connect">
              <strong>官方账号授权</strong>
              <span>
                {runtime?.credentialReady === true ? '已连接 Runner vault' : '未连接'}
                {draft.credentialRef !== undefined ? ` · ${draft.credentialRef}` : ''}
              </span>
              <button
                class="primary-action"
                disabled={draft.connecting ||
                  identity === undefined ||
                  !oauthProvidersLoaded ||
                  oauthProviderFor(draft) === undefined}
                on:click={() => connectOAuth(teammate)}
              >
                {draft.connecting ? '等待授权…' : '登录 / 连接'}
              </button>
              {#if oauthProviderFor(draft) !== undefined}
                <small>{oauthProviderFor(draft)?.label}</small>
              {/if}
            </div>
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
              Harness
              {#if detectedHarnesses.length > 0}
                <select
                  value={draft.harness}
                  on:change={(event) => updateDraft(teammate._id, 'harness', fieldValue(event))}
                >
                  {#each detectedHarnesses as harness}
                    <option value={harness.id}>{harness.label}</option>
                  {/each}
                </select>
              {:else}
                <span class="empty-harness inline">未检测到 harness</span>
              {/if}
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
            <details class="advanced">
              <summary>高级：使用 API Key</summary>
              <label>
                API Key
                <input
                  type="password"
                  autocomplete="off"
                  value={draft.credential}
                  on:input={(event) => {
                    updateDraft(teammate._id, 'credential', fieldValue(event))
                    updateDraft(teammate._id, 'authType', 'api-key')
                  }}
                  placeholder={runtime?.credentialReady === true ? '留空以保留现有凭据' : '输入 API Key'}
                />
              </label>
            </details>
          </div>

          <div class="actions">
            <span class="message">{draft.message}</span>
            <span class="error-message">{draft.error}</span>
            <button
              disabled={draft.saving || identity === undefined || detectedHarnesses.length === 0}
              on:click={() => saveProfile(teammate)}
            >
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
  .harness-detection {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
    padding: 1rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.75rem;
    background: var(--theme-panel-color);
  }
  .harness-detection > div {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 0.4rem;
  }
  .harness-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .harness-chip {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.55rem;
    border-radius: 999px;
    background: var(--theme-bg-color);
  }
  .harness-chip code {
    color: var(--theme-dark-color);
    font-size: 0.75rem;
  }
  .empty-harness {
    color: var(--theme-dark-color);
  }
  .empty-harness.inline {
    padding: 0.55rem 0;
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
  .adapter,
  .oauth-connect {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.8rem;
  }
  .oauth-connect {
    grid-column: 1 / -1;
    padding: 0.75rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
  }
  .oauth-connect span {
    overflow-wrap: anywhere;
    color: var(--theme-dark-color);
  }
  .oauth-connect .primary-action {
    align-self: flex-start;
    color: var(--primary-button-color);
    background: var(--primary-button-default);
    border-color: transparent;
    border-radius: 0.35rem;
  }
  .advanced {
    grid-column: 1 / -1;
    padding: 0.5rem 0;
  }
  .advanced summary {
    cursor: pointer;
    color: var(--theme-dark-color);
  }
  .advanced label {
    margin-top: 0.75rem;
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

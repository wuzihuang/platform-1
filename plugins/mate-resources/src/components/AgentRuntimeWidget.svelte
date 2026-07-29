<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Component, Label } from '@hcengineering/ui'
  import { getCurrentAccount } from '@hcengineering/core'
  import { getMetadata } from '@hcengineering/platform'
  import presentation from '@hcengineering/presentation'
  import diffview from '@hcengineering/diffview'
  import { parseDiff } from '@hcengineering/diffview-resources'
  import { Terminal } from '@xterm/xterm'
  import '@xterm/xterm/css/xterm.css'
  import mate from '../plugin'

  type Tab = 'terminal' | 'console' | 'logs' | 'diff'
  interface ConsoleEvent {
    id: string
    kind: string
    title: string
    body: string
    at: string
  }
  interface RuntimeLog {
    source: string
    level: string
    line: string
    at: string
  }
  interface RuntimeRun {
    runId: string
    mateId: string
    status: string
    diff?: string
    console?: ConsoleEvent[]
    logs?: RuntimeLog[]
  }
  interface Bootstrap {
    runs: RuntimeRun[]
    runner?: { online: boolean, runnerId?: string }
  }

  let activeTab: Tab = 'terminal'
  let bootstrap: Bootstrap = { runs: [] }
  let selectedRunId = ''
  let runtime: RuntimeRun | undefined
  let error = ''
  let terminalHost: HTMLDivElement
  let terminal: Terminal | undefined
  let socket: WebSocket | undefined
  let terminalMode = 'agent'
  let loading = true

  const baseUrl = (getMetadata(mate.metadata.OrchestratorURL) ?? '').replace(/\/$/, '')
  const wsBase = (getMetadata(mate.metadata.OrchestratorWebSocketURL) ?? baseUrl.replace(/^http/, 'ws')).replace(
    /\/$/,
    ''
  )
  const authToken = getMetadata(presentation.metadata.Token) ?? ''

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
    if (!response.ok) throw new Error(`Runtime request failed (${response.status})`)
    return (await response.json()) as T
  }

  async function refresh (): Promise<void> {
    try {
      bootstrap = await api<Bootstrap>('/bootstrap')
      selectedRunId ||= bootstrap.runs[0]?.runId ?? ''
      runtime =
        selectedRunId === '' ? undefined : await api<RuntimeRun>(`/runs/${encodeURIComponent(selectedRunId)}/runtime`)
      error = ''
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function attachTerminal (): Promise<void> {
    if (selectedRunId === '' || terminal === undefined) return
    socket?.close()
    const ticket = await api<{ ticket: string }>(`/runs/${encodeURIComponent(selectedRunId)}/terminal/ticket`, {
      method: 'POST',
      body: '{}'
    })
    socket = new WebSocket(
      `${wsBase}/terminal?runId=${encodeURIComponent(selectedRunId)}&ticket=${encodeURIComponent(ticket.ticket)}`
    )
    socket.binaryType = 'arraybuffer'
    socket.onmessage = (event) => {
      terminal?.write(typeof event.data === 'string' ? event.data : new Uint8Array(event.data))
    }
    socket.onopen = () => terminal?.writeln('\r\n\x1b[32mAttached to runner PTY\x1b[0m')
    socket.onclose = () => terminal?.writeln('\r\n\x1b[90mTerminal detached\x1b[0m')
    terminal.onData((data) => {
      if (terminalMode === 'human' && socket?.readyState === WebSocket.OPEN) socket.send(data)
    })
  }

  async function setTakeover (action: 'takeover' | 'release'): Promise<void> {
    await api(`/runs/${encodeURIComponent(selectedRunId)}/terminal/control`, {
      method: 'POST',
      body: JSON.stringify({ action, actorAccountId: getCurrentAccount().uuid })
    })
    terminalMode = action === 'takeover' ? 'human' : 'agent'
  }

  function selectTab (tab: string): void {
    activeTab = tab as Tab
  }

  $: diffFiles = parseDiff(runtime?.diff ?? '')
  $: if (selectedRunId !== '' && terminal !== undefined) void attachTerminal()

  onMount(() => {
    terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 12,
      theme: { background: '#111318' }
    })
    terminal.open(terminalHost)
    terminal.writeln('Agent Runtime — select a run to attach')
    void refresh()
  })

  onDestroy(() => {
    socket?.close()
    terminal?.dispose()
  })
</script>

<div class="runtime-widget">
  <header>
    <div class="title">
      <Label label={mate.string.AgentRuntime} />
      <span class:online={bootstrap.runner?.online} class="presence">
        {bootstrap.runner?.online ? 'Runner online' : 'Runner offline'}
      </span>
    </div>
    <select bind:value={selectedRunId} on:change={refresh} aria-label="Runtime run">
      {#each bootstrap.runs as run}
        <option value={run.runId}>{run.mateId} · {run.status} · {run.runId.slice(0, 8)}</option>
      {/each}
    </select>
  </header>

  <nav aria-label="Agent runtime views">
    {#each ['terminal', 'console', 'logs', 'diff'] as tab}
      <button class:active={activeTab === tab} on:click={() => { selectTab(tab) }}>
        {tab === 'diff' ? 'Git Diff' : tab[0].toUpperCase() + tab.slice(1)}
      </button>
    {/each}
  </nav>

  {#if error !== ''}
    <div class="error">{error}</div>
  {:else if loading}
    <div class="empty">Loading runtime…</div>
  {/if}

  <section class:hidden={activeTab !== 'terminal'} class="terminal-panel">
    <div class="terminal-actions">
      <span>{terminalMode === 'human' ? 'Human takeover lease active' : 'Agent control'}</span>
      {#if terminalMode === 'human'}
        <button on:click={() => setTakeover('release')}>Release</button>
      {:else}
        <button disabled={selectedRunId === ''} on:click={() => setTakeover('takeover')}>Take over</button>
      {/if}
    </div>
    <div class="terminal" bind:this={terminalHost}></div>
  </section>

  {#if activeTab === 'console'}
    <section class="stream">
      {#each runtime?.console ?? [] as event}
        <article>
          <span class="badge">{event.kind}</span>
          <strong>{event.title}</strong>
          <time>{new Date(event.at).toLocaleTimeString()}</time>
          <pre>{event.body}</pre>
        </article>
      {:else}
        <div class="empty">No structured agent events for this run.</div>
      {/each}
    </section>
  {:else if activeTab === 'logs'}
    <section class="stream logs">
      {#each runtime?.logs ?? [] as log}
        <div><time>{new Date(log.at).toLocaleTimeString()}</time> <b>{log.source}</b> [{log.level}] {log.line}</div>
      {:else}
        <div class="empty">No runtime logs for this run.</div>
      {/each}
    </section>
  {:else if activeTab === 'diff'}
    <section class="diff">
      {#each diffFiles as file (file.fileName)}
        <Component is={diffview.component.FileDiffView} props={{ file, mode: 'unified', showViewed: false }} />
      {:else}
        <div class="empty">No Git diff is available for this run.</div>
      {/each}
    </section>
  {/if}
</div>

<style lang="scss">
  .runtime-widget {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: var(--theme-panel-color);
  }
  header,
  nav,
  .terminal-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  header {
    justify-content: space-between;
    padding: 0.75rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .title {
    display: flex;
    flex-direction: column;
    font-weight: 600;
  }
  .presence {
    color: var(--theme-dark-color);
    font-size: 0.7rem;
  }
  .presence.online {
    color: var(--positive-color);
  }
  select {
    min-width: 0;
    max-width: 55%;
  }
  nav {
    padding: 0.4rem 0.75rem 0;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  nav button {
    padding: 0.45rem 0.65rem;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--theme-dark-color);
  }
  nav button.active {
    border-color: var(--primary-button-default);
    color: var(--theme-caption-color);
  }
  section {
    min-height: 0;
    overflow: auto;
  }
  .terminal-panel {
    display: flex;
    flex: 1;
    flex-direction: column;
  }
  .terminal-panel.hidden {
    position: absolute;
    visibility: hidden;
    pointer-events: none;
  }
  .terminal-actions {
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
  }
  .terminal {
    flex: 1;
    min-height: 15rem;
    padding: 0.4rem;
    background: #111318;
  }
  .stream,
  .diff {
    padding: 0.75rem;
  }
  article {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.5rem;
    padding: 0.6rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  article pre {
    grid-column: 1 / -1;
    margin: 0;
    white-space: pre-wrap;
  }
  .logs {
    font-family: monospace;
    font-size: 0.75rem;
    line-height: 1.6;
  }
  .badge {
    color: var(--primary-button-default);
  }
  .empty,
  .error {
    padding: 1.25rem;
    color: var(--theme-dark-color);
  }
  .error {
    color: var(--error-color);
  }
</style>

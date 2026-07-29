<script lang="ts">
  import type { Mate, MateIdentity } from '@hcengineering/mate'
  import mate from '../plugin'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label, Button } from '@hcengineering/ui'
  import workbench, { type Widget } from '@hcengineering/workbench'
  import { openWidget } from '@hcengineering/workbench-resources'

  const mateQuery = createQuery()
  const identityQuery = createQuery()
  let mates: Mate[] = []
  let identities: MateIdentity[] = []

  mateQuery.query(mate.class.Mate, {}, (result) => {
    mates = result
  })
  identityQuery.query(mate.class.MateIdentity, {}, (result) => {
    identities = result
  })

  function identityFor (value: Mate): MateIdentity | undefined {
    return identities.find((identity) => identity.mate === value._id)
  }

  function showRuntime (): void {
    const widget = getClient().getModel().findAllSync<Widget>(workbench.class.Widget, {
      _id: mate.ids.AgentRuntimeWidget
    })[0]
    if (widget !== undefined) {
      openWidget(widget, { active: true }, { active: true, openedByUser: true })
    }
  }
</script>

<div class="mate-settings">
  <header>
    <div>
      <h2><Label label={mate.string.AiTeammates} /></h2>
      <p>AI teammates use independent Huly accounts, identities, and runtime credentials.</p>
    </div>
    <Button label={mate.string.AgentRuntime} kind="primary" on:click={showRuntime} />
  </header>

  <div class="mate-list">
    {#each mates as teammate}
      {@const identity = identityFor(teammate)}
      <article>
        <div class="avatar">{teammate.role === 'first' ? '1M' : '2M'}</div>
        <div class="details">
          <strong>{teammate.name}</strong>
          <span>{teammate.role === 'first' ? 'First Mate' : 'Second Mate'}</span>
        </div>
        <span class:ready={identity !== undefined} class="state">
          {identity !== undefined ? 'Provisioned' : 'Awaiting provisioner'}
        </span>
      </article>
    {/each}
  </div>
</div>

<style lang="scss">
  .mate-settings {
    padding: 1.5rem;
    max-width: 64rem;
  }
  header,
  article {
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
  .details span {
    color: var(--theme-dark-color);
  }
  .mate-list {
    display: grid;
    gap: 0.75rem;
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
  .state {
    color: var(--warning-color);
  }
  .state.ready {
    color: var(--positive-color);
  }
</style>

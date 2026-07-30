import type { Metadata, Plugin, Resource } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { TriggerFunc } from '@hcengineering/server-core'

export const serverMateId = 'server-mate' as Plugin

export default plugin(serverMateId, {
  metadata: {
    OrchestratorURL: '' as Metadata<string>,
    OrchestratorSecret: '' as Metadata<string>,
    IdentitySeeds: '' as Metadata<string>
  },
  trigger: {
    ProvisionMateIdentities: '' as Resource<TriggerFunc>,
    RouteMateChat: '' as Resource<TriggerFunc>,
    RouteMateMention: '' as Resource<TriggerFunc>
  }
})

import activity from '@hcengineering/activity'
import chunter from '@hcengineering/chunter'
import core from '@hcengineering/core'
import type { Builder } from '@hcengineering/model'
import serverCore from '@hcengineering/server-core'
import serverMate from '@hcengineering/server-mate'

export { serverMateId } from '@hcengineering/server-mate'

export function createModel (builder: Builder): void {
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverMate.trigger.ProvisionMateIdentities,
    txMatch: { objectClass: core.class.UserStatus },
    isAsync: true
  })
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverMate.trigger.RouteMateChat,
    txMatch: {
      _class: core.class.TxCreateDoc,
      objectClass: chunter.class.ChatMessage
    },
    isAsync: true
  })
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverMate.trigger.RouteMateMention,
    txMatch: {
      _class: core.class.TxCreateDoc,
      objectClass: activity.class.ActivityReference
    },
    isAsync: true
  })
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverMate.trigger.RouteMateUserMention,
    txMatch: {
      _class: core.class.TxCreateDoc,
      objectClass: activity.class.UserMentionInfo
    },
    isAsync: true
  })
}

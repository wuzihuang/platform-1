import type { ActivityReference } from '@hcengineering/activity'
import chunter, { type ChatMessage, type DirectMessage, type ThreadMessage } from '@hcengineering/chunter'
import contact from '@hcengineering/contact'
import { type AccountUuid, type Doc, type PersonId, type Tx, type TxCreateDoc, TxProcessor } from '@hcengineering/core'
import mate, { type HulyMentionEvent, type MateChatEvent, type MateIdentity } from '@hcengineering/mate'
import type { TriggerControl } from '@hcengineering/server-core'
import { provisionMateIdentities } from './provisioner'
import { hasMateEndpoint, postOrchestrator } from './transport'

async function mateIdentities (control: TriggerControl): Promise<MateIdentity[]> {
  return control.findAll(control.ctx, mate.class.MateIdentity, {})
}

async function selfSocialIds (identities: MateIdentity[], control: TriggerControl): Promise<Set<PersonId>> {
  const ids = new Set(identities.map((identity) => identity.socialId).filter((id): id is PersonId => id !== undefined))
  const people = identities.map((identity) => identity.person).filter((id) => id !== undefined)
  if (people.length !== 0) {
    const socialIds = await control.findAll(control.ctx, contact.class.SocialIdentity, {
      attachedTo: { $in: people }
    })
    socialIds.forEach((socialId) => ids.add(socialId._id))
  }
  return ids
}

async function messageParent (message: ChatMessage, control: TriggerControl): Promise<Doc | undefined> {
  if (control.hierarchy.isDerived(message._class, chunter.class.ThreadMessage) === true) {
    const thread = message as ThreadMessage
    return (await control.findAll(control.ctx, thread.objectClass, { _id: thread.objectId }, { limit: 1 }))[0]
  }
  return (await control.findAll(control.ctx, message.attachedToClass, { _id: message.attachedTo }, { limit: 1 }))[0]
}

async function RouteMateChat (originTxs: TxCreateDoc<ChatMessage>[], control: TriggerControl): Promise<Tx[]> {
  if (!hasMateEndpoint()) return []
  const identities = await mateIdentities(control)
  const selfIds = await selfSocialIds(identities, control)

  for (const tx of originTxs) {
    const message = TxProcessor.createDoc2Doc(tx)
    const author = message.createdBy ?? message.modifiedBy
    if (selfIds.has(author)) continue
    const parent = await messageParent(message, control)
    if (parent === undefined || control.hierarchy.isDerived(parent._class, chunter.class.DirectMessage) !== true) {
      continue
    }

    const members = (parent as DirectMessage).members
    const addressed = identities.filter((identity) => members.includes(identity.account as AccountUuid))
    if (addressed.length !== 1) continue

    const event: MateChatEvent = {
      type: 'mate.chat',
      eventId: `huly:${control.workspace.uuid}:chat:${message._id}`,
      threadId: String(parent._id),
      createdBy: String(author),
      mateId: String(addressed[0].mate),
      text: String(message.message),
      occurredAt: new Date(message.createdOn ?? message.modifiedOn).toISOString()
    }
    await postOrchestrator('/events', event, control)
  }
  return []
}

async function RouteMateMention (originTxs: TxCreateDoc<ActivityReference>[], control: TriggerControl): Promise<Tx[]> {
  if (!hasMateEndpoint()) return []
  const identities = await mateIdentities(control)
  const selfIds = await selfSocialIds(identities, control)

  for (const tx of originTxs) {
    const reference = TxProcessor.createDoc2Doc(tx)
    const author = reference.createdBy ?? reference.modifiedBy
    if (selfIds.has(author)) continue
    const addressed = identities.filter((identity) => identity.person === reference.attachedTo)
    if (addressed.length !== 1) continue

    const event: HulyMentionEvent = {
      type: 'huly.mention',
      eventId: `huly:${control.workspace.uuid}:mention:${reference._id}`,
      sourceId: String(reference.srcDocId),
      sourceClass: String(reference.srcDocClass),
      createdBy: String(author),
      mateId: String(addressed[0].mate),
      text: reference.message,
      occurredAt: new Date(reference.createdOn ?? reference.modifiedOn).toISOString()
    }
    await postOrchestrator('/events', event, control)
  }
  return []
}

async function ProvisionMateIdentities (_txs: Tx[], control: TriggerControl): Promise<Tx[]> {
  return await provisionMateIdentities(control)
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export default async () => ({
  trigger: {
    ProvisionMateIdentities,
    RouteMateChat,
    RouteMateMention
  }
})

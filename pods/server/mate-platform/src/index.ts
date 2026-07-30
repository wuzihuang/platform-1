import chunter from '@hcengineering/chunter'
import contact, { type Person, type SocialIdentity } from '@hcengineering/contact'
import core, {
  type AccountUuid,
  type PersonId,
  type Ref,
  type Space,
  TxOperations,
  type WorkspaceUuid
} from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import { createClient } from '@hcengineering/server-client'
import serverToken, { generateToken } from '@hcengineering/server-token'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

const port = Number.parseInt(process.env.SERVER_PORT ?? '8099')
const secret = process.env.MATE_ORCHESTRATOR_SECRET ?? ''
const transactorUrl = process.env.TRANSACTOR_URL ?? 'ws://transactor:3333'

setMetadata(serverToken.metadata.Secret, process.env.SERVER_SECRET)
setMetadata(serverToken.metadata.Service, 'mate-platform')

interface MateChatDelivery {
  eventId: string
  runId: string
  stage?: string
  workspaceId: WorkspaceUuid
  threadId: string
  createdBy: AccountUuid
  credentialRef: string
  text: string
}

function send (response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

async function body (request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function deliverMateChat (delivery: MateChatDelivery, kind: 'reply' | 'progress'): Promise<void> {
  const token = generateToken(delivery.createdBy, delivery.workspaceId, { service: 'mate-platform' })
  const client = await createClient(transactorUrl, token)
  try {
    const suffix = kind === 'reply' ? delivery.runId : `${delivery.runId}-${delivery.stage ?? delivery.eventId}`
    const messageId = `mate-${kind}-${suffix}`.replace(/[^A-Za-z0-9:_-]/g, '-') as Ref<chunter.ChatMessage>
    if ((await client.findOne(chunter.class.ChatMessage, { _id: messageId })) !== undefined) return

    const person = await client.findOne(contact.class.Person, {
      personUuid: delivery.createdBy
    }) as Person | undefined
    if (person === undefined) throw new Error('Mate person not found')
    const socialId = await client.findOne(contact.class.SocialIdentity, {
      attachedTo: person._id,
      isDeleted: false
    }) as SocialIdentity | undefined
    if (socialId === undefined) throw new Error('Mate social identity not found')

    const direct = await client.findOne(chunter.class.DirectMessage, {
      _id: delivery.threadId as Ref<chunter.DirectMessage>
    })
    if (direct === undefined) throw new Error('Mate direct message thread not found')

    const tx = new TxOperations(client, socialId._id as PersonId)
    await tx.addCollection(
      chunter.class.ChatMessage,
      direct._id as Ref<Space>,
      direct._id,
      direct._class,
      'messages',
      {
        message: JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: delivery.text }] }]
        }),
        attachments: 0
      },
      messageId
    )
  } finally {
    await client.close()
  }
}

createServer((request, response) => {
  void (async () => {
    if (request.method === 'GET' && request.url === '/health') {
      send(response, 200, { ok: true })
      return
    }
    const match = request.url?.match(/^\/internal\/mate\/events\/mate\.(reply|progress)$/)
    if (
      request.method !== 'POST' ||
      match === undefined ||
      secret === '' ||
      request.headers.authorization !== `Bearer ${secret}`
    ) {
      send(response, 404, { error: 'Not found' })
      return
    }
    try {
      await deliverMateChat(await body(request) as MateChatDelivery, match[1] as 'reply' | 'progress')
      send(response, 202, { accepted: true })
    } catch (error) {
      console.error('Mate chat delivery failed', error)
      send(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  })()
}).listen(port, '0.0.0.0')

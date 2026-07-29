import contact, { AvatarType } from '@hcengineering/contact'
import core, {
  AccountRole,
  buildSocialIdString,
  type AccountUuid,
  type PersonUuid,
  SocialIdType,
  systemAccountUuid,
  type Tx,
  type WorkspaceUuid
} from '@hcengineering/core'
import mate, { type Mate, type MateRole } from '@hcengineering/mate'
import { getMetadata } from '@hcengineering/platform'
import { getAccountClient } from '@hcengineering/server-client'
import type { TriggerControl } from '@hcengineering/server-core'
import serverMate from '@hcengineering/server-mate'
import { generateToken } from '@hcengineering/server-token'
import { postOrchestrator } from './transport'

export interface MateIdentitySeed {
  mateId: string
  role: MateRole
  email: string
  password: string
  firstName: string
  lastName: string
  avatarColor?: string
  tokenRef: string
}

function readSeeds (control: TriggerControl): MateIdentitySeed[] {
  const value = getMetadata(serverMate.metadata.IdentitySeeds) ?? ''
  if (value === '') {
    control.ctx.warn('Mate identity provisioning is disabled: MATE_IDENTITY_SEEDS is empty')
    return []
  }
  try {
    const seeds = JSON.parse(value) as MateIdentitySeed[]
    return seeds.filter(
      (seed) =>
        seed.mateId !== '' &&
        seed.email !== '' &&
        seed.password !== '' &&
        seed.tokenRef !== '' &&
        (seed.role === 'first' || seed.role === 'second')
    )
  } catch (error) {
    control.ctx.error('Could not parse MATE_IDENTITY_SEEDS', { error })
    return []
  }
}

async function confirmAccount (account: PersonUuid, email: string): Promise<void> {
  const client = getAccountClient(
    generateToken(account, undefined, { service: 'mate-provisioner', confirmEmail: email })
  )
  try {
    await client.confirm()
  } catch {
    // Confirmation is idempotent and an already confirmed account is expected.
  }
}

async function ensureAccount (seed: MateIdentitySeed, workspace: WorkspaceUuid): Promise<AccountUuid | undefined> {
  const systemToken = generateToken(systemAccountUuid, undefined, { service: 'mate-provisioner' })
  const accountClient = getAccountClient(systemToken)
  const socialKey = buildSocialIdString({ type: SocialIdType.EMAIL, value: seed.email })
  let personUuid = await accountClient.findPersonBySocialKey(socialKey)

  if (personUuid === undefined) {
    const signup = await accountClient.signUp(seed.email, seed.password, seed.firstName, seed.lastName)
    personUuid = signup?.account
  }
  if (personUuid === undefined) return undefined

  await confirmAccount(personUuid, seed.email)
  await accountClient.assignWorkspace(seed.email, workspace, AccountRole.User)
  return personUuid as AccountUuid
}

async function ensureIdentityDoc (seed: MateIdentitySeed, account: AccountUuid, control: TriggerControl): Promise<Tx[]> {
  const txes: Tx[] = []
  const mateDoc = (
    await control.findAll(control.ctx, mate.class.Mate, { _id: seed.mateId as Mate['_id'] }, { limit: 1 })
  )[0]
  if (mateDoc === undefined) {
    control.ctx.warn('Mate identity seed references an unknown Mate model document', { mateId: seed.mateId })
    return txes
  }

  const person = (
    await control.findAll(control.ctx, contact.class.Person, { personUuid: account as PersonUuid }, { limit: 1 })
  )[0]
  const socialKey = buildSocialIdString({ type: SocialIdType.EMAIL, value: seed.email })
  const socialId = (
    await control.findAll(control.ctx, contact.class.SocialIdentity, { key: socialKey }, { limit: 1 })
  )[0]
  const identity = (await control.findAll(control.ctx, mate.class.MateIdentity, { mate: mateDoc._id }, { limit: 1 }))[0]

  const identityData = {
    mate: mateDoc._id,
    account,
    person: person?._id,
    socialId: socialId?._id,
    tokenRef: seed.tokenRef,
    provisionedOn: Date.now()
  }
  let identityId = identity?._id
  if (identity === undefined) {
    const tx = control.txFactory.createTxCreateDoc(mate.class.MateIdentity, core.space.Workspace, identityData)
    identityId = tx.objectId
    txes.push(tx)
  } else {
    txes.push(control.txFactory.createTxUpdateDoc(mate.class.MateIdentity, identity.space, identity._id, identityData))
  }
  if (mateDoc.identity !== identityId) {
    txes.push(
      control.txFactory.createTxUpdateDoc(mate.class.Mate, mateDoc.space, mateDoc._id, { identity: identityId })
    )
  }
  if (person !== undefined) {
    txes.push(
      control.txFactory.createTxUpdateDoc(contact.class.Person, person.space, person._id, {
        avatarType: AvatarType.COLOR,
        avatarProps: { color: seed.avatarColor ?? (seed.role === 'first' ? '#6C5CE7' : '#0984E3') }
      })
    )
  }

  await postOrchestrator(
    '/identity/provisioned',
    {
      type: 'identity.provisioned',
      mateId: mateDoc._id,
      role: seed.role,
      accountId: account,
      personId: person?._id,
      socialId: socialId?._id,
      tokenRef: seed.tokenRef,
      accountToken: generateToken(account, control.workspace.uuid, { service: 'mate' })
    },
    control
  )
  return txes
}

export async function provisionMateIdentities (control: TriggerControl): Promise<Tx[]> {
  const txes: Tx[] = []
  for (const seed of readSeeds(control)) {
    try {
      const account = await ensureAccount(seed, control.workspace.uuid)
      if (account === undefined) {
        control.ctx.error('Mate account provisioning returned no account', { mateId: seed.mateId })
        continue
      }
      txes.push(...(await ensureIdentityDoc(seed, account, control)))
    } catch (error) {
      control.ctx.error('MateIdentityProvisioner failed', { mateId: seed.mateId, error })
    }
  }
  return txes
}

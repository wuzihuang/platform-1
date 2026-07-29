import contact, {
  AvatarType,
  combineName,
  type Employee,
  type Person,
  type SocialIdentity,
  type SocialIdentityRef
} from '@hcengineering/contact'
import core, {
  AccountRole,
  buildSocialIdString,
  type AccountUuid,
  type Data,
  generateId,
  type PersonUuid,
  type Ref,
  type SocialId,
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

interface ProvisionedAccount {
  account: AccountUuid
  socialId: SocialId
}

const MATE_ACCOUNT_TOKEN_TTL_SECONDS = 15 * 60
const MATE_PROVISIONER_SERVICE = 'mate-provisioner'

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
    generateToken(account, undefined, { service: MATE_PROVISIONER_SERVICE, confirmEmail: email })
  )
  try {
    await client.confirm()
  } catch {
    // Confirmation is idempotent and an already confirmed account is expected.
  }
}

async function ensureAccount (seed: MateIdentitySeed, workspace: WorkspaceUuid): Promise<ProvisionedAccount | undefined> {
  const systemToken = generateToken(systemAccountUuid, undefined, { service: MATE_PROVISIONER_SERVICE })
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

  const socialId = await accountClient.findFullSocialIdBySocialKey(socialKey)
  if (socialId === undefined || socialId.personUuid !== personUuid) return undefined

  return { account: personUuid as AccountUuid, socialId }
}

async function ensureLocalIdentity (
  seed: MateIdentitySeed,
  account: AccountUuid,
  accountSocialId: SocialId,
  control: TriggerControl
): Promise<{ txes: Tx[], person?: Ref<Person>, socialId?: SocialIdentityRef }> {
  const txes: Tx[] = []
  const socialIdRef = accountSocialId._id as SocialIdentityRef
  const localPersonByUuid = (
    await control.findAll(control.ctx, contact.class.Person, { personUuid: account as PersonUuid }, { limit: 1 })
  )[0]
  const localSocialIdByRef = (
    await control.findAll(control.ctx, contact.class.SocialIdentity, { _id: socialIdRef }, { limit: 1 })
  )[0]
  const localSocialIds = await control.findAll(control.ctx, contact.class.SocialIdentity, { key: accountSocialId.key })
  const staleSocialIds = localSocialIds.filter((socialId) => socialId._id !== socialIdRef)
  const localSocialId = staleSocialIds[0]
  let person = localPersonByUuid

  if (person === undefined && localSocialIdByRef !== undefined) {
    person = (
      await control.findAll(control.ctx, contact.class.Person, { _id: localSocialIdByRef.attachedTo }, { limit: 1 })
    )[0]
  }

  if (person === undefined && localSocialId !== undefined) {
    person = (
      await control.findAll(control.ctx, contact.class.Person, { _id: localSocialId.attachedTo }, { limit: 1 })
    )[0]
  }

  const name = combineName(seed.firstName, seed.lastName)
  const avatarProps = { color: seed.avatarColor ?? (seed.role === 'first' ? '#6C5CE7' : '#0984E3') }
  const personData: Data<Person> = {
    name,
    city: '',
    avatarType: AvatarType.COLOR,
    avatarProps,
    personUuid: account as PersonUuid
  }
  const personRef = person?._id ?? generateId<Person>()

  if (person === undefined) {
    txes.push(control.txFactory.createTxCreateDoc(contact.class.Person, contact.space.Contacts, personData, personRef))
  } else {
    txes.push(control.txFactory.createTxUpdateDoc(contact.class.Person, person.space, person._id, personData))
  }

  const socialIdentityData: Data<SocialIdentity> = {
    attachedTo: personRef,
    attachedToClass: contact.class.Person,
    collection: 'socialIds',
    type: accountSocialId.type,
    value: accountSocialId.value,
    key: accountSocialId.key,
    displayValue: accountSocialId.displayValue,
    verifiedOn: accountSocialId.verifiedOn,
    isDeleted: accountSocialId.isDeleted ?? false
  }

  if (localSocialIdByRef === undefined) {
    txes.push(
      control.txFactory.createTxCollectionCUD(
        contact.class.Person,
        personRef,
        contact.space.Contacts,
        'socialIds',
        control.txFactory.createTxCreateDoc(
          contact.class.SocialIdentity,
          contact.space.Contacts,
          socialIdentityData,
          socialIdRef
        )
      )
    )
  } else {
    txes.push(
      control.txFactory.createTxUpdateDoc(
        contact.class.SocialIdentity,
        localSocialIdByRef.space,
        localSocialIdByRef._id,
        socialIdentityData
      )
    )
  }

  for (const staleSocialId of staleSocialIds) {
    txes.push(
      control.txFactory.createTxUpdateDoc(
        contact.class.SocialIdentity,
        staleSocialId.space,
        staleSocialId._id,
        { isDeleted: true, key: `${staleSocialId.key}:replaced:${String(staleSocialId._id)}` }
      )
    )
  }

  const employee = (
    await control.findAll(control.ctx, contact.mixin.Employee, { _id: personRef as Ref<Employee> }, { limit: 1 })
  )[0]
  const employeeRole: Employee['role'] = 'USER'
  if (employee === undefined || employee.active !== true || employee.role !== employeeRole) {
    txes.push(
      control.txFactory.createTxMixin(personRef, contact.class.Person, contact.space.Contacts, contact.mixin.Employee, {
        active: true,
        role: employeeRole
      })
    )
  }

  return { txes, person: personRef, socialId: socialIdRef }
}

function generateMateAccountToken (account: AccountUuid, workspace: WorkspaceUuid): string {
  const now = Math.floor(Date.now() / 1000)
  return generateToken(account, workspace, { service: 'mate' }, undefined, {
    nbf: now - 30,
    exp: now + MATE_ACCOUNT_TOKEN_TTL_SECONDS
  })
}

async function ensureIdentityDoc (
  seed: MateIdentitySeed,
  provisioned: ProvisionedAccount,
  control: TriggerControl
): Promise<Tx[]> {
  const txes: Tx[] = []
  const mateDoc = (
    await control.findAll(control.ctx, mate.class.Mate, { _id: seed.mateId as Mate['_id'] }, { limit: 1 })
  )[0]
  if (mateDoc === undefined) {
    control.ctx.warn('Mate identity seed references an unknown Mate model document', { mateId: seed.mateId })
    return txes
  }

  const localIdentity = await ensureLocalIdentity(seed, provisioned.account, provisioned.socialId, control)
  txes.push(...localIdentity.txes)

  const identity = (await control.findAll(control.ctx, mate.class.MateIdentity, { mate: mateDoc._id }, { limit: 1 }))[0]

  const identityData = {
    mate: mateDoc._id,
    account: provisioned.account,
    person: localIdentity.person,
    socialId: localIdentity.socialId,
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

  await postOrchestrator(
    '/identity/provisioned',
    {
      type: 'identity.provisioned',
      mateId: mateDoc._id,
      role: seed.role,
      accountId: provisioned.account,
      personId: localIdentity.person,
      socialId: localIdentity.socialId,
      tokenRef: seed.tokenRef,
      accountToken: generateMateAccountToken(provisioned.account, control.workspace.uuid)
    },
    control
  )
  return txes
}

export async function provisionMateIdentities (control: TriggerControl): Promise<Tx[]> {
  const txes: Tx[] = []
  for (const seed of readSeeds(control)) {
    try {
      const provisioned = await ensureAccount(seed, control.workspace.uuid)
      if (provisioned === undefined) {
        control.ctx.error('Mate account provisioning returned no account', { mateId: seed.mateId })
        continue
      }
      txes.push(...(await ensureIdentityDoc(seed, provisioned, control)))
    } catch (error) {
      control.ctx.error('MateIdentityProvisioner failed', { mateId: seed.mateId, error })
    }
  }
  return txes
}

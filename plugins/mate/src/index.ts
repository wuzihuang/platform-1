import type { Person } from '@hcengineering/contact'
import type { AccountUuid, Class, Doc, PersonId, Ref, Timestamp } from '@hcengineering/core'
import type { Asset, IntlString, Metadata, Plugin } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { AnyComponent } from '@hcengineering/ui'
import type { Widget } from '@hcengineering/workbench'

export const mateId = 'mate' as Plugin

export type MateRole = 'first' | 'second'
export type MateRunStatus =
  'queued' | 'dispatched' | 'running' | 'waiting-approval' | 'completed' | 'failed' | 'cancelled'

export interface Mate extends Doc {
  name: string
  role: MateRole
  enabled: boolean
  identity?: Ref<MateIdentity>
}

export interface MateIdentity extends Doc {
  mate: Ref<Mate>
  account: AccountUuid
  person?: Ref<Person>
  socialId?: PersonId
  tokenRef: string
  provisionedOn?: Timestamp
}

export interface BrainProfile extends Doc {
  mate: Ref<Mate>
  provider: string
  model: string
  authType: 'api-key' | 'oauth'
  credentialRef: string
  systemPromptRef?: string
}

export interface HarnessProfile extends Doc {
  mate: Ref<Mate>
  harness: string
  model: string
  effort: string
  allowedRoots: string[]
  credentialRef: string
}

export interface RunnerNode extends Doc {
  name: string
  endpoint: string
  credentialRef: string
  online: boolean
  capabilities: string[]
  lastSeen?: Timestamp
}

export interface ProjectBinding extends Doc {
  project: Ref<Doc>
  runner: Ref<RunnerNode>
  repository: string
  worktreeRoot?: string
}

export interface MateAssignment extends Doc {
  mate: Ref<Mate>
  project: Ref<Doc>
  assignedBy: AccountUuid
  active: boolean
}

export interface MateRun extends Doc {
  mate: Ref<Mate>
  assignment?: Ref<MateAssignment>
  eventId: string
  externalRunId?: string
  status: MateRunStatus
  startedOn?: Timestamp
  finishedOn?: Timestamp
}

export interface ApprovalRequest extends Doc {
  run: Ref<MateRun>
  operation: string
  risk: 'low' | 'medium' | 'high'
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  requestedOn: Timestamp
  decidedBy?: AccountUuid
  decidedOn?: Timestamp
}

export interface ArtifactReference extends Doc {
  run: Ref<MateRun>
  kind: 'document' | 'file' | 'diff' | 'report' | 'link'
  label: string
  objectId?: Ref<Doc>
  objectClass?: Ref<Class<Doc>>
  uri?: string
}

export interface MateChatEvent {
  type: 'mate.chat'
  eventId: string
  threadId: string
  createdBy: string
  mateId: string
  text: string
  occurredAt: string
}

export interface HulyMentionEvent {
  type: 'huly.mention'
  eventId: string
  sourceId: string
  sourceClass: string
  createdBy: string
  mateId: string
  text: string
  occurredAt: string
}

const mate = plugin(mateId, {
  metadata: {
    OrchestratorURL: '' as Metadata<string>,
    OrchestratorWebSocketURL: '' as Metadata<string>
  },
  class: {
    Mate: '' as Ref<Class<Mate>>,
    MateIdentity: '' as Ref<Class<MateIdentity>>,
    BrainProfile: '' as Ref<Class<BrainProfile>>,
    HarnessProfile: '' as Ref<Class<HarnessProfile>>,
    RunnerNode: '' as Ref<Class<RunnerNode>>,
    ProjectBinding: '' as Ref<Class<ProjectBinding>>,
    MateAssignment: '' as Ref<Class<MateAssignment>>,
    MateRun: '' as Ref<Class<MateRun>>,
    ApprovalRequest: '' as Ref<Class<ApprovalRequest>>,
    ArtifactReference: '' as Ref<Class<ArtifactReference>>
  },
  component: {
    AgentRuntimeWidget: '' as AnyComponent,
    AiTeammatesSettings: '' as AnyComponent
  },
  icon: {
    Mate: '' as Asset,
    Runtime: '' as Asset
  },
  string: {
    Mate: '' as IntlString,
    Mates: '' as IntlString,
    AgentRuntime: '' as IntlString,
    AiTeammates: '' as IntlString
  },
  ids: {
    AgentRuntimeWidget: '' as Ref<Widget>,
    AiTeammatesSettings: '' as Ref<Doc>,
    FirstMate: '' as Ref<Mate>,
    SecondMate: '' as Ref<Mate>,
    FirstMateBrain: '' as Ref<BrainProfile>,
    SecondMateBrain: '' as Ref<BrainProfile>,
    FirstMateHarness: '' as Ref<HarnessProfile>,
    SecondMateHarness: '' as Ref<HarnessProfile>
  }
})

export default mate

import { AccountRole, type Domain, IndexKind } from '@hcengineering/core'
import { Index, Model, Prop, TypeBoolean, TypeRef, TypeString, UX, type Builder } from '@hcengineering/model'
import core, { TDoc } from '@hcengineering/model-core'
import setting from '@hcengineering/setting'
import workbench, { WidgetType } from '@hcengineering/workbench'
import type {
  ApprovalRequest,
  ArtifactReference,
  BrainProfile,
  HarnessProfile,
  Mate,
  MateAssignment,
  MateIdentity,
  MateRun,
  ProjectBinding,
  RunnerNode
} from '@hcengineering/mate'
import mate from './plugin'

export { mateId } from '@hcengineering/mate'
export const DOMAIN_MATE = 'mate' as Domain

@Model(mate.class.Mate, core.class.Doc, DOMAIN_MATE)
@UX(mate.string.Mate, mate.icon.Mate)
export class TMate extends TDoc implements Mate {
  @Prop(TypeString(), core.string.Name)
  @Index(IndexKind.FullText)
    name!: string

  role!: Mate['role']

  @Prop(TypeBoolean(), core.string.Status)
    enabled!: boolean

  identity?: Mate['identity']
}

@Model(mate.class.MateIdentity, core.class.Doc, DOMAIN_MATE)
export class TMateIdentity extends TDoc implements MateIdentity {
  @Prop(TypeRef(mate.class.Mate), mate.string.Mate)
  @Index(IndexKind.Indexed)
    mate!: MateIdentity['mate']

  account!: MateIdentity['account']
  person?: MateIdentity['person']
  socialId?: MateIdentity['socialId']
  tokenRef!: string
  provisionedOn?: MateIdentity['provisionedOn']
}

@Model(mate.class.BrainProfile, core.class.Doc, DOMAIN_MATE)
export class TBrainProfile extends TDoc implements BrainProfile {
  mate!: BrainProfile['mate']
  provider!: string
  model!: string
  authType!: BrainProfile['authType']
  credentialRef!: string
  systemPromptRef?: string
}

@Model(mate.class.HarnessProfile, core.class.Doc, DOMAIN_MATE)
export class THarnessProfile extends TDoc implements HarnessProfile {
  mate!: HarnessProfile['mate']
  harness!: string
  model!: string
  effort!: string
  allowedRoots!: string[]
  credentialRef!: string
}

@Model(mate.class.RunnerNode, core.class.Doc, DOMAIN_MATE)
export class TRunnerNode extends TDoc implements RunnerNode {
  name!: string
  endpoint!: string
  credentialRef!: string
  online!: boolean
  capabilities!: string[]
  lastSeen?: RunnerNode['lastSeen']
}

@Model(mate.class.ProjectBinding, core.class.Doc, DOMAIN_MATE)
export class TProjectBinding extends TDoc implements ProjectBinding {
  project!: ProjectBinding['project']
  runner!: ProjectBinding['runner']
  repository!: string
  worktreeRoot?: string
}

@Model(mate.class.MateAssignment, core.class.Doc, DOMAIN_MATE)
export class TMateAssignment extends TDoc implements MateAssignment {
  mate!: MateAssignment['mate']
  project!: MateAssignment['project']
  assignedBy!: MateAssignment['assignedBy']
  active!: boolean
}

@Model(mate.class.MateRun, core.class.Doc, DOMAIN_MATE)
export class TMateRun extends TDoc implements MateRun {
  mate!: MateRun['mate']
  assignment?: MateRun['assignment']

  @Index(IndexKind.Indexed)
    eventId!: string

  externalRunId?: string
  status!: MateRun['status']
  startedOn?: MateRun['startedOn']
  finishedOn?: MateRun['finishedOn']
}

@Model(mate.class.ApprovalRequest, core.class.Doc, DOMAIN_MATE)
export class TApprovalRequest extends TDoc implements ApprovalRequest {
  run!: ApprovalRequest['run']
  operation!: string
  risk!: ApprovalRequest['risk']
  status!: ApprovalRequest['status']
  requestedOn!: ApprovalRequest['requestedOn']
  decidedBy?: ApprovalRequest['decidedBy']
  decidedOn?: ApprovalRequest['decidedOn']
}

@Model(mate.class.ArtifactReference, core.class.Doc, DOMAIN_MATE)
export class TArtifactReference extends TDoc implements ArtifactReference {
  run!: ArtifactReference['run']
  kind!: ArtifactReference['kind']
  label!: string
  objectId?: ArtifactReference['objectId']
  objectClass?: ArtifactReference['objectClass']
  uri?: string
}

export function createModel (builder: Builder): void {
  builder.createModel(
    TMate,
    TMateIdentity,
    TBrainProfile,
    THarnessProfile,
    TRunnerNode,
    TProjectBinding,
    TMateAssignment,
    TMateRun,
    TApprovalRequest,
    TArtifactReference
  )

  builder.createDoc(
    workbench.class.Widget,
    core.space.Model,
    {
      label: mate.string.AgentRuntime,
      type: WidgetType.Flexible,
      icon: mate.icon.Runtime,
      component: mate.component.AgentRuntimeWidget,
      accessLevel: AccountRole.User
    },
    mate.ids.AgentRuntimeWidget
  )

  builder.createDoc(
    setting.class.WorkspaceSettingCategory,
    core.space.Model,
    {
      name: 'ai-teammates',
      label: mate.string.AiTeammates,
      icon: mate.icon.Mate,
      component: mate.component.AiTeammatesSettings,
      group: 'settings-editor',
      role: AccountRole.User,
      order: 3650
    },
    mate.ids.AiTeammatesSettings
  )

  builder.createDoc(core.class.DomainIndexConfiguration, core.space.Model, {
    domain: DOMAIN_MATE,
    disabled: [{ _class: 1 }, { space: 1 }, { modifiedBy: 1 }, { modifiedOn: 1 }]
  })
}

export default mate
export { mateOperation } from './migration'

import { TxOperations } from '@hcengineering/core'
import {
  tryMigrate,
  tryUpgrade,
  type MigrateOperation,
  type MigrationClient,
  type MigrationUpgradeClient
} from '@hcengineering/model'
import core from '@hcengineering/model-core'
import mate, { mateId, type Mate } from '@hcengineering/mate'

export const mateOperation: MigrateOperation = {
  async migrate (client: MigrationClient, mode): Promise<void> {
    await tryMigrate(mode, client, mateId, [])
  },
  async upgrade (state: Map<string, Set<string>>, client: () => Promise<MigrationUpgradeClient>, mode): Promise<void> {
    await tryUpgrade(mode, state, client, mateId, [
      {
        state: 'create-default-team-and-profiles-v2',
        func: async (upgradeClient) => {
          const tx = new TxOperations(upgradeClient, core.account.System)
          const mates: Array<{
            id: Mate['_id']
            name: string
            role: Mate['role']
            brainId: typeof mate.ids.FirstMateBrain
            harnessId: typeof mate.ids.FirstMateHarness
          }> = [
            {
              id: mate.ids.FirstMate,
              name: 'First Mate',
              role: 'first',
              brainId: mate.ids.FirstMateBrain,
              harnessId: mate.ids.FirstMateHarness
            },
            {
              id: mate.ids.SecondMate,
              name: 'Second Mate',
              role: 'second',
              brainId: mate.ids.SecondMateBrain,
              harnessId: mate.ids.SecondMateHarness
            }
          ]
          for (const teammate of mates) {
            if ((await tx.findOne(mate.class.Mate, { _id: teammate.id })) === undefined) {
              await tx.createDoc(
                mate.class.Mate,
                core.space.Workspace,
                { name: teammate.name, role: teammate.role, enabled: true },
                teammate.id
              )
            }
            const credentialRef = `vault://brain/${String(teammate.id)}`
            if ((await tx.findOne(mate.class.BrainProfile, { _id: teammate.brainId })) === undefined) {
              await tx.createDoc(
                mate.class.BrainProfile,
                core.space.Workspace,
                {
                  mate: teammate.id,
                  provider: 'openai',
                  model: 'gpt-5.6-sol',
                  authType: 'api-key',
                  credentialRef
                },
                teammate.brainId
              )
            }
            if ((await tx.findOne(mate.class.HarnessProfile, { _id: teammate.harnessId })) === undefined) {
              await tx.createDoc(
                mate.class.HarnessProfile,
                core.space.Workspace,
                {
                  mate: teammate.id,
                  harness: 'codex',
                  model: 'gpt-5.6-sol',
                  effort: 'medium',
                  allowedRoots: ['/worktrees'],
                  credentialRef
                },
                teammate.harnessId
              )
            }
          }
        }
      }
    ])
  }
}

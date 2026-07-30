# Mate integration deployment

The Mate integration adds Huly-native teammate identities and one Workbench
sidebar widget. It does not register a Workbench application, navigation item,
chat replacement, agent home, inspector, or drawer.

## Services and environment

Expose the Mate orchestrator through the same TLS boundary as Huly. The browser
must be able to reach the HTTP and WebSocket URLs; the transactor should use the
Docker-internal service URL.

Transactor (`pod-server`) environment:

```dotenv
MATE_ORCHESTRATOR_URL=http://pod-mate-orchestrator:4025
MATE_ORCHESTRATOR_SECRET=<shared-random-secret>
MATE_IDENTITY_SEEDS=[{"mateId":"mate:ids:FirstMate","role":"first","email":"first-mate@huly.zephwu.com","password":"<secret>","firstName":"First","lastName":"Mate","avatarColor":"#6C5CE7","tokenRef":"vault://mate/first"},{"mateId":"mate:ids:SecondMate","role":"second","email":"second-mate@huly.zephwu.com","password":"<secret>","firstName":"Second","lastName":"Mate","avatarColor":"#0984E3","tokenRef":"vault://mate/second"}]
```

Front (`pod-front`) environment:

```dotenv
MATE_ORCHESTRATOR_URL=https://huly.zephwu.com/mate-api
MATE_ORCHESTRATOR_WS_URL=wss://huly.zephwu.com/mate-api
```

The reverse proxy must preserve WebSocket upgrades below `/mate-api`. Keep
`MATE_ORCHESTRATOR_SECRET` and identity passwords out of images and source
control. The seed `tokenRef` is treated as a namespace hint; provisioning stores
a workspace-and-Mate-scoped reference. `tokenRef` is a credential reference; the only account token sent by
the platform is the short-lived, workspace-scoped token delivered over the
authenticated internal `/identity/provisioned` call.

`MateIdentityProvisioner` uses the account service to create or reuse each
global account, confirms it idempotently, assigns it to the workspace as a
user, and links the resulting Person, Employee, SocialIdentity, and color
avatar to `MateIdentity`. Provisioning is retried on user-presence events, so a
workspace/account propagation delay is self-healing.
Once linked, a Mate keeps that account and social identity even if seed
defaults change, preserving existing direct-message membership and history.

## Orchestrator contract

The platform sends authenticated JSON to:

- `POST /identity/provisioned` for an identity/account-token refresh.
- `POST /events` for `mate.chat` and `huly.mention` events. `eventId` and the
  `Idempotency-Key` header are stable across retries.
- `GET /bootstrap` and `GET /runs/:runId/runtime` for widget state.
- `POST /runs/:runId/terminal/ticket` for a single-use terminal ticket.
- `WS /terminal?runId=…&ticket=…` for runner PTY transport.
- `POST /runs/:runId/terminal/control` for bounded `takeover` and `release`
  lease changes.

Huly and the orchestrator only route typed commands. Shell, Git, PTY, tmux,
Firstmate, and harness execution remain in the Runner.

## huly.zephwu.com acceptance

1. Regenerate/apply the model and restart front/transactor with the variables
   above.
2. In Contacts, find First Mate and Second Mate and confirm each has its own
   person, employee identity, email, and avatar.
3. Open a direct message with exactly one Mate. Send a message and a thread
   reply; confirm the reply author is that Mate, not the legacy AI bot.
4. Mention a Mate from a supported activity editor and confirm one idempotent
   run starts. Messages authored by either Mate must not create another run.
5. Open Settings → AI Teammates, then open Agent Runtime. Confirm it appears
   only in the right Workbench sidebar.
6. Select a run and check Terminal ticket attach/takeover/release, structured
   Agent Console events, Logs, and Git Diff rendered by Huly's
   `FileDiffView`.

Rollback is configuration-first: remove the three transactor variables and two
front variables, then regenerate the prior model/front images. Existing Mate
documents and contacts are inert when the plugin is disabled and can be
retained for audit.

# ABOS Environment Execution & Lifecycle v2

Status: provider-neutral foundation merged to `main`; AWS/EC2 execution is active development on `abos/aws-ec2-lifecycle-v1`.

## Purpose

Adaptive Path Intelligence can already reason about required capabilities and preferred
environments. Environment Lifecycle v2 turns that intent into tracked physical/digital
resources without hardcoding provider order into the Orchestrator.

The architectural rule is capability-first:

- objective != method;
- environment != objective;
- missing/unknown capability != impossible;
- unsupported provider operation means unavailable on that provider now;
- providers may expose future operations without modifying the central lifecycle contract;
- policy, authorization, treasury, physical constraints, and explicit prohibitions remain authoritative.

## Provider-neutral flow

```text
OBJECTIVE
  -> PATH / CAPABILITY REQUIREMENTS
  -> ENVIRONMENT SELECTOR
  -> READINESS + ESTIMATE + POLICY
  -> RESOURCE OWNERSHIP REGISTERED
  -> PREPARE / PROVISION / ADOPT
  -> BOOTSTRAP
  -> EXECUTE
  -> HEALTH + COST + EVIDENCE
  -> RETAIN / REUSE / RESIZE / MIGRATE / SUSPEND / RECOVER / DESTROY
  -> RECONCILE AFTER RESTART
```

## Open operation model

`CORE_ENVIRONMENT_OPERATIONS` documents common operations ABOS understands today.
It is not an allowlist. `EnvironmentProvider.operations` accepts arbitrary provider-native
operation names, and `EnvironmentRegistry.getSupportedOperations()` discovers both
implemented lifecycle methods and provider-native extensions.

Central orchestration must not use provider-name branching to decide which environment is
eligible. Selection belongs to `EnvironmentSelector`.

## Resource ownership

Schema v13 introduces:

- `environment_resources`
- `environment_resource_events`

A resource is linked, when available, to Goal, Path, and Task. Ownership is persisted
before provisioning begins so a failed or interrupted provisioning operation still leaves
evidence for recovery/reconciliation.

Raw credentials must never be stored in `credentials_reference`; that field is only a
reference to an authorized credential source.

## Selection semantics

`EnvironmentSelector` ranks all registered providers from current evidence. It considers:

- capability fit;
- current availability;
- required lifecycle operations;
- preferred environment as a preference rather than a lock;
- provider reliability estimates when known;
- explicit cost budgets and provider estimates when known;
- reusable resources when reported;
- optional external policy evaluation.

An explicit budget fails closed when cost is unknown. A candidate that is unavailable,
unauthorized, over budget, or missing required operations remains visible as evidence but
is not selected for immediate execution.

No candidate being executable is not proof of objective impossibility. It becomes discovery,
authorization, acquisition, composition, construction, or alternate-path work.

## Task execution bridge

`EnvironmentExecutionBridge` connects planner intent to physical Task execution without
encoding a Conway-first, Local-second provider order.

- `EnvironmentTaskExecutorRegistry` is open-ended: environment IDs are data, not an allowlist.
- Selection and Task execution are separate concerns. A provider can exist before a Task
  executor adapter for it has been discovered or implemented.
- Task/tool capabilities are not automatically treated as infrastructure SKUs. The full Task
  remains available to the executor adapter so capability acquisition/composition remains open.
- A selected environment spawn failure is surfaced as structured evidence. The bridge does not
  silently try another provider after an actual execution attempt fails.
- Dispatch is environment-native. Local direct execution and Conway funding/colony messaging
  live in their respective adapters rather than in the Orchestrator.
- Missing spawn/dispatch support means currently unavailable or not-yet-discovered execution
  capability, not objective impossibility.
- Execution failures are tagged by operation (`selection`, `spawn`, `dispatch`) so Adaptive
  Path Intelligence can reason from the actual failure stage.
- Existing Conway child lifecycle, wallet identity, credentials, and sandbox machinery are
  reused; Environment Lifecycle v2 does not replace or re-key them.

Successful executor resources are rebound to Goal, Path, and Task ownership and dispatch evidence
is written into the generic environment resource event stream.

Synchronous transports may return a semantic `TaskResult` directly from dispatch. Those results
enter the same canonical Orchestrator completion/failure path as asynchronous Colony messages;
transport success is not confused with Task success.

## Lifecycle manager

`EnvironmentLifecycleManager` is provider-neutral. It:

1. registers resource ownership before provisioning;
2. records lifecycle transitions/evidence;
3. invokes only operations a provider currently implements;
4. distinguishes unsupported operation from impossible objective;
5. supports adoption of already-existing resources;
6. records health observations;
7. preserves unknown state when destructive/reconciliation operations cannot be verified;
8. supports provider-neutral retention sweeps after Task/Goal terminal state;
9. gates destructive retries behind fresh provider observation instead of blindly repeating them.

Local, Conway, AWS, and future providers can progressively implement this contract without
creating new central orchestration authorities.

## AWS / EC2 execution status

The AWS provider now implements real EC2 lifecycle control through the AWS CLI:

- STS authorization discovery and region resolution;
- EC2 create with deterministic client token + ABOS ownership tags;
- Amazon Linux 2023 AMI discovery when no image is pinned;
- optional subnet, security groups, key name, and IAM instance profile;
- EC2 waiters for running/stopped/terminated state;
- SSM-online readiness observation before bootstrap;
- Node.js 22 + pnpm build bootstrap;
- runtime checkout pinned to the current ABOS git revision by default;
- one-shot Task execution through SSM using the canonical ABOS harness layer;
- semantic `TaskResult` returned to the parent Orchestrator;
- health, collect, resize, suspend, resume, recover, destroy, and reconcile;
- restart recovery by `abos:resource-id` tag if provisioning succeeded before the InstanceId was persisted;
- compute-only price estimates kept explicitly separate from actual AWS billing;
- AWS cost coverage is marked `partial`; an explicit budget fails closed unless a provider estimate declares `complete` coverage.

The EC2 Task executor currently requires SSM reachability. In practice the instance needs an IAM
instance profile that authorizes Systems Manager (for example a profile containing the AWS managed
`AmazonSSMManagedInstanceCore` policy). ABOS can accept that profile through
`ABOS_AWS_EC2_INSTANCE_PROFILE` or provider metadata. Missing authorization is classified as
currently unavailable/requires authorization, not as objective impossibility.

The current one-shot remote worker intentionally does not claim the `orchestrator` harness because
that harness requires a live delegated-worker scheduler. Other roles use the same harness registry
as Local execution. This is an unavailable remote coordination capability to extend later, not a
closed capability boundary.

## Retention semantics

`EnvironmentRetentionCoordinator` evaluates persisted ownership and declared retention policy:

- `ephemeral`: release after the owning Task reaches completed/failed/cancelled;
- `until_goal_complete`: release after the owning Goal reaches completed/failed;
- `persistent` and `manual_retention`: never auto-destroy;
- unknown/custom policies: no destructive semantics are invented.

A destroy that cannot be verified becomes `pending_observation`. ABOS reconciles provider state
before another destructive attempt. If the observed condition is unchanged, it does not blindly
repeat the same destroy route. Provider-verified absence satisfies the retention boundary without
fabricating a billing/destruction event.

## Integration sequence

1. **Implemented:** foundation contracts + resource persistence + selector.
2. **Implemented:** Local lifecycle adapter.
3. **Implemented:** Conway adapter by reusing `src/replication/*`, not duplicating it.
4. **Implemented:** provider-neutral Task spawn + dispatch bridge; hardcoded Conway→Local fallback removed.
5. **Implemented:** AWS lifecycle foundation and EC2 + SSM one-shot Task execution.
6. **Implemented:** EC2 health/reconciliation, compute-only cost evidence, and provider-neutral retention.
7. **Implemented:** restart recovery for owned AWS instances and observation-gated destructive retry.
8. **Next:** remote multi-worker/orchestrator harness support, richer AWS authorization acquisition, cross-environment migration/reuse policy, and final phase freeze.

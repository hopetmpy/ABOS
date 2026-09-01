# ABOS Environment Execution & Lifecycle v2

Status: active development on `abos/environment-lifecycle-v2`.

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

## Lifecycle manager

`EnvironmentLifecycleManager` is provider-neutral. It:

1. registers resource ownership before provisioning;
2. records lifecycle transitions/evidence;
3. invokes only operations a provider currently implements;
4. distinguishes unsupported operation from impossible objective;
5. supports adoption of already-existing resources;
6. records health observations;
7. preserves unknown state when destructive/reconciliation operations cannot be verified.

Local, Conway, AWS, and future providers can progressively implement this contract without
creating new central orchestration authorities.

## Integration sequence

1. **Implemented:** foundation contracts + resource persistence + selector.
2. **Implemented:** Local lifecycle adapter.
3. **Implemented:** Conway adapter by reusing `src/replication/*`, not duplicating it.
4. **Implemented:** provider-neutral Task spawn + dispatch bridge; hardcoded Conway→Local fallback removed.
5. **Next:** AWS lifecycle foundation and EC2 end-to-end resource management.
6. Cost/health/retention decisions.
7. Restart reconciliation and migration across environments.
8. Full regression and freeze.

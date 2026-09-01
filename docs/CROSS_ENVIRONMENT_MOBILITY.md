# Cross-Environment Recovery, Reuse & Migration v1

Status: active development on `abos/cross-environment-migration-v1`.

Base freeze: `main@8b63fa126ebb9b13a6ac78ba011d73d586162f0c`
(AWS / EC2 Lifecycle v1 merged and post-merge CI green).

## Purpose

ABOS already has:

- Adaptive Path Intelligence;
- an open Environment Registry;
- evidence-based EnvironmentSelector;
- provider-neutral resource ownership/lifecycle;
- Local, Conway, and AWS execution adapters;
- restart reconciliation, retention, and artifact preservation.

The next problem is continuity across environments.

A failed provider attempt must not cause ABOS to blindly repeat the same
environment under the same conditions. At the same time, a provider must not be
globally blacklisted merely because one Task or one condition failed.

The mobility layer therefore makes **attempt + environment + observed condition**
durable evidence.

## Architectural invariants

1. Objective != method.
2. Environment != objective.
3. Provider IDs are runtime data, not a central allowlist.
4. Failure scope matters: a failed resource is not automatically a failed provider.
5. A provider-scoped failure is contextual evidence, not a permanent ban.
6. Same provider-scoped failure + same Task/Path intent + same observed condition
   is an equivalent retry and is deferred.
7. A materially changed observed condition can make the same environment
   eligible again.
8. A materially different strategic Path can use the same provider when the
   method/conditions are no longer equivalent.
9. Resource-scoped failures exclude the failed resource from reuse while
   preserving other healthy/provisionable resources from the same provider.
10. Recovery is observation-first.
11. Recovery never provisions a replacement.
12. Migration planning never provisions or destroys.
13. Actual provider execution failure is surfaced to Adaptive Path Intelligence;
    mobility does not hide it with a same-turn silent fallback.
14. Unknown/unavailable/unauthorized/not-yet-discovered remain distinct from
    impossible.
15. Resource ownership and lifecycle remain authoritative in
    `environment_resources`; mobility does not create a second resource ledger.
16. Migration transactions persist across restart.
17. Retention release authority outranks mobility recovery: resources already in
    artifact hold, destroy observation, unavailable-destroy, or released states
    are never revived by the mobility coordinator.

## Persistent mobility authority

Schema v14 adds:

### `environment_migrations`

A durable source → target continuity transaction:

- Goal / Path / Task identity;
- source resource and provider;
- target resource and provider;
- open-ended status;
- reason and requirements;
- attempted environments;
- latest condition fingerprint by environment;
- evidence and metadata;
- completion time.

Statuses are deliberately not constrained by a SQL provider/strategy allowlist.
The runtime recognizes current lifecycle conventions while allowing future
migration phases without a schema rewrite.

### `environment_migration_events`

Append-only transition/attempt evidence:

- operation;
- previous/current status;
- reason;
- evidence;
- metadata;
- timestamp.

This preserves the sequence even when the migration record stores only the most
recent condition fingerprint for an environment.

## Condition identity

An environment-attempt fingerprint currently includes stable observations that
can materially change execution eligibility:

- environment ID;
- availability;
- exposed capabilities and their availability/requirements/permissions;
- constraints;
- provider cost model;
- currently exposed provider operations;
- Task ID and strategic Path ID;
- agent role;
- required Task capabilities;
- preferred environment.

It intentionally excludes observation timestamps.

Therefore:

```
same task/path
+ same environment
+ same material observation
= equivalent failed environment route
```

For provider-scoped failures, that provider route is contextually excluded from
the next equivalent selection.

For resource-scoped failures, the provider remains eligible while the failed
resource ID is excluded from executor reuse. This allows ABOS to use another
healthy resource or provision a fresh resource from the same provider when the
provider itself remains viable.

If provider state changes materially, the fingerprint changes and a previously
provider-scoped exclusion can be reconsidered.

## Selection and reuse

`EnvironmentRequirements.excludedEnvironmentIds` is a contextual per-selection
input. It is not a global blacklist.

Excluded candidates remain in selector output with blockers/evidence. They are
not erased from knowledge.

`EnvironmentSelector` can also consume a provider-neutral reuse evaluator.
The runtime derives reuse evidence from canonical owned resources in
`environment_resources`.

Current reusable inventory states are:

- ready;
- running;
- suspended.

Resources that are degraded, unknown, terminated, failed, released, or holding
pending artifacts are not counted as immediately reusable evidence.

The Task executor adapter still performs its own final assessment. Inventory
reuse evidence affects ranking; it does not manufacture executability.

## Failure → distinct route

The runtime flow is:

```
Task / Path
   ↓
EnvironmentSelector
   ↓
EnvironmentExecutionBridge
   ↓
actual spawn or dispatch attempt
   ↓
failure
   ↓
EnvironmentMobilityCoordinator
   ├─ persist migration
   ├─ persist environment + stage + evidence
   ├─ fingerprint material conditions
   └─ mark owned failed executor degraded
   ↓
failure still reaches Adaptive Path Intelligence
   ↓
next equivalent Task/Path environment selection
   ↓
unchanged failed environment excluded
   ↓
alternate eligible environment / discovery / authorization / acquisition
```

There is intentionally no silent same-turn failover after a real attempt. A
real failure must first become evidence.

## Recovery

Recovery is different from migration.

Recovery tries to restore an existing owned resource. It:

1. identifies degraded / unknown / recovering resources;
2. reconciles provider reality when supported;
3. stops if the resource is already ready/running/suspended;
4. preserves UNKNOWN when state cannot be verified;
5. calls provider `recover` only for a still-degraded resource;
6. records a recovery-condition fingerprint before mutation;
7. does not repeat `recover` when the observed condition fingerprint is
   unchanged.

The recovery sweep does not provision replacements and does not destroy
resources. It also refuses to reconcile/recover resources whose
`retentionReleaseState` is already owned by the retention lifecycle
(`artifact_hold`, `destroy_requested`, `pending_observation`,
`destroy_unavailable`, or `released`). This prevents recovery and cleanup
authorities from fighting each other.

## Migration planning

`environment_migration_plan` is non-destructive.

Given a source resource and requirements it:

1. persists a mobility transaction;
2. excludes the specific source resource from reuse evidence;
3. keeps the source provider eligible unless provider-scoped evidence says otherwise;
4. evaluates all registered providers through the normal selector;
5. preserves blockers and evidence for every candidate;
6. records the selected target provider when one is currently executable.

No provider-pair route such as AWS→Conway is encoded.

A future provider can participate by registering the same environment/lifecycle
and Task-executor contracts.

## Agent-facing surfaces

The environment tool set now includes:

- `environment_migrations` — inspect durable mobility transactions;
- `environment_migration_plan` — non-destructive alternative planning;
- `environment_recovery_sweep` — observation-gated recovery;
- existing environment selector/resource/health/reconcile/collect surfaces.

## Current boundary

This phase does not claim transparent live-process checkpoint migration.

For the current ABOS Task model, continuity means:

- preserve objective/path evidence;
- preserve/collect durable Task artifacts;
- avoid reusing an unhealthy executor without fresh evidence;
- select or spawn a materially distinct executor route;
- continue Task/Path execution through the canonical Orchestrator and
  EnvironmentExecutionBridge.

Live memory/process checkpointing can be added later as provider capabilities
without redefining the mobility authority.

## Validation goals

Before freeze this phase must prove:

1. migration state survives SQLite restart;
2. contextual exclusions remain visible, not globally erased;
3. unchanged provider-scoped failure conditions produce a different next route;
4. resource-scoped failure excludes only the failed resource, not the provider;
5. changed material conditions reopen a provider-scoped route;
6. planning causes no provision/destroy side effect;
7. degraded recovery is observation-first;
8. unchanged recovery conditions do not repeat provider mutation;
9. canonical resource reuse influences selection;
10. degraded resources are not assigned as live workers;
11. Local / Conway / AWS remain provider-neutral;
12. no provider-pair branches appear in Orchestrator;
13. Node 20/22, Windows, security, rebrand, and public distribution remain green.

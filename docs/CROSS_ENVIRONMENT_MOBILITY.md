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
4. A failed environment attempt is contextual evidence, not a permanent ban.
5. Same failed environment + same Task/Path intent + same observed condition
   is an equivalent retry and is deferred.
6. A materially changed observed condition can make the same environment
   eligible again.
7. A materially different strategic Path can use the same provider when the
   method/conditions are no longer equivalent.
8. Recovery is observation-first.
9. Recovery never provisions a replacement.
10. Migration planning never provisions or destroys.
11. Actual provider execution failure is surfaced to Adaptive Path Intelligence;
    mobility does not hide it with a same-turn silent fallback.
12. Unknown/unavailable/unauthorized/not-yet-discovered remain distinct from
    impossible.
13. Resource ownership and lifecycle remain authoritative in
    `environment_resources`; mobility does not create a second resource ledger.
14. Migration transactions persist across restart.

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

That route is contextually excluded from the next environment selection.

If the provider state changes materially, the fingerprint changes and that
provider may be reconsidered.

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
resources.

## Migration planning

`environment_migration_plan` is non-destructive.

Given a source resource and requirements it:

1. persists a mobility transaction;
2. contextually excludes the current source environment;
3. evaluates all registered providers through the normal selector;
4. preserves blockers and evidence for every candidate;
5. records the selected target provider when one is currently executable.

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
3. unchanged failed environment conditions produce a different next route;
4. changed material conditions reopen the provider;
5. planning causes no provision/destroy side effect;
6. degraded recovery is observation-first;
7. unchanged recovery conditions do not repeat provider mutation;
8. canonical resource reuse influences selection;
9. degraded resources are not assigned as live workers;
10. Local / Conway / AWS remain provider-neutral;
11. no provider-pair branches appear in Orchestrator;
12. Node 20/22, Windows, security, rebrand, and public distribution remain green.

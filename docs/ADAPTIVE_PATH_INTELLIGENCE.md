# ABOS Adaptive Path Intelligence

Status: canonical architecture for the adaptive-path evolution introduced by PR #10.

## Purpose

ABOS must remain persistent about the objective while remaining flexible about the route used to achieve it. A failed method is evidence about the problem; it is not automatically evidence that the objective failed.

This subsystem turns that principle into runtime state, persistence, planner context, and orchestration behavior.

## Core invariants

1. Objective != method.
2. Strategic failure != technical retry.
3. A substantially equivalent failed path is not retried under unchanged conditions.
4. A path may be reconsidered when material conditions change.
5. UNKNOWN != IMPOSSIBLE.
6. Missing capabilities may be discovered, acquired, composed, or constructed.
7. Explicitly prohibited paths are excluded; prohibition of one path does not imply impossibility of the objective.
8. Policy, authorization, treasury, physical, and technical constraints remain authoritative.
9. Environments are means. Local, Conway, AWS, and future providers are evaluated by actual availability/capabilities.
10. Evidence is persisted so replanning can incorporate what previous attempts learned.

## Runtime flow

```text
OBJECTIVE
   |
   v
PLANNER / POSSIBILITY SPACE
   |
   v
PATH CANDIDATE
   |
   +--> hypothesis
   +--> assumptions
   +--> required capabilities
   +--> preferred environment
   +--> sequence
   +--> expected outcome
   |
   v
NOVELTY / EQUIVALENCE CHECK
   |
   v
EXECUTION
   |
   v
OBSERVATION
   |
   v
FAILURE CLASSIFICATION OR SUCCESS
   |
   +--> technical transient -> narrow retry when justified
   |
   +--> strategic / capability / environment / assumption failure
             |
             v
       STRUCTURED EVIDENCE
             |
             v
       WORLD MODEL UPDATE
             |
             v
       POSSIBILITY EXPANSION / REPLAN
```

## Main components

### `src/intelligence/`

- `types.ts`: canonical Path, Attempt, Failure, Evidence, Assumption, World Fact, Opportunity, and task-binding contracts.
- `path-signature.ts`: conceptual path identity plus runtime condition fingerprints.
- `novelty.ts`: detects equivalent paths and allows reconsideration when material conditions changed.
- `failure-classifier.ts`: separates transient, authorization, environment, capability, assumption, prohibited, impossible, and strategic failures.
- `store.ts`: SQLite persistence for paths, attempts, evidence, assumptions, facts, opportunities, and task bindings.
- `possibility-space.ts`: current set of known paths, exhausted signatures, open opportunities, facts, and assumptions.
- `adaptive-engine.ts`: coordinates classification, evidence, assumption learning, path status, novelty, and planner context.
- `task-path.ts`: maps Planner/TaskGraph state to canonical path candidates.

### `src/capabilities/`

The capability layer lets planning reason across tools, skills, services, APIs, CLIs, executors, workers, cloud resources, scripts, and future capability types.

The resolver can return:

- `use_existing`
- `change_environment`
- `acquire`
- `compose`
- `construct`
- `unknown`

Absence from the registry is not treated as proof of impossibility.

### `src/environments/`

Environment providers expose real availability and advertised capabilities through one abstraction.

Current providers:

- Local
- Conway
- AWS

AWS uses the installed AWS CLI and STS caller identity to distinguish:

- CLI unavailable
- authorization required
- environment available

No AWS credentials are embedded in ABOS.

Provider-native command execution is argv-based rather than shell-interpolated. Agent-visible output is bounded and redacted for common credential material.

## SQLite schema

Schema version 12 adds sidecar tables without replacing the legacy Goal/TaskGraph schema:

- `adaptive_paths`
- `adaptive_task_bindings`
- `adaptive_attempts`
- `adaptive_evidence`
- `adaptive_assumptions`
- `adaptive_world_facts`
- `adaptive_opportunities`

The sidecar design lets the existing orchestrator remain the execution authority while adaptive intelligence records the strategic context around it.

## Task bindings

Planner intent must survive materialization into the TaskGraph.

Each persisted task may be bound to:

- strategic path ID
- required capabilities
- preferred environment

Workers receive this execution intent. A replan cancels unfinished work belonging to the superseded strategy rather than silently requeueing it.

Late results from cancelled/superseded paths do not resurrect the obsolete plan.

## Failure semantics

### Technical retry

Used only for a narrow transient condition such as a timeout or temporary connectivity failure. A retry must be justified by novelty or a material condition change.

### Strategic failure

Produces evidence and adaptive replanning. It does not consume a universal retry budget.

A replan counter may remain as telemetry, but it is not evidence that the objective is impossible.

## Planner behavior

The planner receives:

- adaptive path history
- recent attempts
- world facts
- assumptions
- structured evidence
- open opportunities
- environment snapshots
- unified capabilities

The planner is instructed to preserve the goal, challenge invalid assumptions, avoid equivalent failed routes, and distinguish UNKNOWN/UNAVAILABLE from IMPOSSIBLE.

Planner inference failure does not fabricate a single-task route. The objective is preserved and the planner failure becomes evidence/opportunity state.

## AWS boundary

PR #10 integrates AWS as an environment/capability provider and provider-native CLI execution surface.

This does **not** yet mean ABOS has a specialized autonomous AWS resource lifecycle for every AWS service.

A later environment-lifecycle phase can build on this abstraction to add:

```text
select environment
-> provision resource
-> bootstrap worker/runtime
-> execute
-> collect result/evidence
-> retain or destroy resource
```

without inserting provider-specific branches throughout the orchestrator.

## Physical prerequisites

The code can be complete even when an external environment is not physically ready.

For AWS, physical readiness may require the operator to install/configure the AWS CLI and provide legitimate account authorization. ABOS must report `requires_authorization` or `unavailable` rather than inventing credentials or declaring the objective impossible.

## Validation matrix

The adaptive-path PR must not be merged until the final HEAD passes:

- TypeScript typecheck
- build
- full Vitest suite
- Node 20 and Node 22 CI jobs
- Windows portability/smoke
- security audit
- rebrand integrity
- public-distribution smoke

Dedicated adaptive tests cover:

- path identity
- path equivalence
- condition-aware novelty
- failure classification
- assumption validation/invalidation
- structured evidence linkage
- capability registry/resolution
- Local/AWS environment inspection
- provider execution routing
- output secret redaction/output bounds
- planner intent -> task binding
- replans superseding obsolete work

## Definition of done for this phase

PR #10 is complete only when:

1. all adaptive components are integrated rather than merely declared;
2. the final HEAD is green in all required CI jobs;
3. the PR diff is audited against the frozen main baseline;
4. no duplicate orchestrator or duplicate memory authority exists;
5. no blind strategic retry or fixed replan counter governs objective survival;
6. documentation matches runtime behavior;
7. the PR is merged only after the evidence above exists.

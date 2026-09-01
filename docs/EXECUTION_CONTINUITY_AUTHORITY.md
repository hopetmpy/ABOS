# Execution Continuity Authority Map v1

Status: canonical design constraint for the execution-continuity phase.

Base freeze: `main@87b4768b79ccd7b2cf087911ced41928e8de53ef`.

## Purpose

Cross-environment continuation must compose existing ABOS authorities instead of creating a second source of truth.

The continuity layer is a **derived view and transport contract**. It does not own Task state, strategic-path state, migration state, resource lifecycle, memory, or artifact truth.

Provider and capability identifiers are open runtime data. Nothing in this document creates a closed provider allowlist. New environments, transports, tools, or capabilities can participate by implementing the existing open contracts.

## Canonical authorities

| Concern | Canonical authority | Existing implementation | Continuity rule |
| --- | --- | --- | --- |
| Goal and Task identity/state | TaskGraph | `src/orchestration/task-graph.ts`, `task_graph` | Never shadow Task status/result in a new continuity table. |
| Task result and semantic artifact references | TaskGraph | `TaskResult` | Continuity may carry a derived copy/reference only. |
| Strategic Path | Adaptive | `src/intelligence/store.ts`, `adaptive_paths` | Path identity and status remain Adaptive-owned. |
| Task -> Path binding | Adaptive | `adaptive_task_bindings` | Continuity reads the current binding; it does not create an independent binding. |
| Attempts, failures, condition fingerprints | Adaptive | `adaptive_attempts` | Historical failures survive environment changes. |
| Adaptive evidence | Adaptive | `adaptive_evidence` | Continuity selects relevant evidence; it is not the evidence ledger. |
| Cross-environment migration transaction | EnvironmentMigrationStore | `src/environments/mobility-store.ts`, schema v14 | No parallel handoff/migration transaction store. |
| Environment attempt history | EnvironmentMigrationStore | migration events + attempt metadata | Reuse existing migration evidence and condition fingerprints. |
| Resource ownership and lifecycle | EnvironmentResourceStore / lifecycle | `src/environments/resource-store.ts`, `lifecycle.ts` | Resource state remains lifecycle-owned. |
| Runtime environment selection and execution | Mobility + ExecutionBridge | `mobility.ts`, `task-executor.ts` | Continuity must not become a second orchestrator or provider selector. |
| General event history | EventStream | `src/memory/event-stream.ts` | Read relevant events; do not duplicate the stream. |
| Long/working/episodic/etc. memory | Memory subsystem | `src/memory/*` | Select relevant memory without creating another memory database. |
| Goal-local files and decisions | AgentWorkspace | `src/orchestration/workspace.ts` | Workspace remains the parent-host file/decision surface. |
| Remote -> parent artifact extraction | Environment lifecycle + provider `collect()` | `EnvironmentLifecycleManager.collect()`, AWS/Conway provider collectors | Reuse the canonical provider lifecycle operation. Missing artifacts remain pending/unknown; remote executor paths never masquerade as parent-local files. |
| Parent -> target artifact materialization | EnvironmentTaskExecutor + derived artifact contract | `src/environments/artifact-materialization.ts`, Local/Conway/AWS executor adapters | Materialize only parent-observed files, verify target integrity, and keep provider/scheme identifiers open. |
| Conway task transport | Colony Messaging | `src/orchestration/messaging.ts`, `colony-task-assignment.ts` | Reuse the existing transport and canonical harness execution; structured assignment/result identity is authenticated before persistence. |
| AWS task transport | AwsEc2TaskExecutor | SSM dispatch | Reuse the existing transport; do not create an AWS-specific continuity orchestrator. |
| Local task execution | LocalWorkerPool adapter | runtime registration in `src/agent/loop.ts` | Reuse the existing executor registration. |

## Explicit non-authorities

The following must **not** become independent sources of truth:

- `ExecutionContinuationContext`
- any future `ContinuityAssembler`
- dispatch metadata
- artifact manifests
- integrity hashes
- provider-specific delivery envelopes

They are derived representations, transport data, or verification evidence.

## Scope boundary

The continuity phase has three separate responsibilities:

1. **Assemble** a derived logical continuation context from canonical authorities.
2. **Deliver** that context through the already-existing provider-neutral execution/dispatch path.
3. **Materialize** required artifacts from the parent host into the selected target when necessary.

These responsibilities must remain separable. Assembly does not select providers. Delivery does not own Task state. Materialization does not redefine artifact truth.

## Path-scoping invariant

Historical knowledge and executable state are different.

When the same Task continues on the same strategic Path, verified Path-scoped executable state may be reused.

When Adaptive selects a different Path:

- Goal/Task identity remains.
- durable Task history remains.
- failures, observations, decisions, evidence, and relevant memory remain.
- artifacts remain available/pending/unknown according to evidence.
- **Path-specific executable checkpoint/state from the old Path must not be blindly applied to the new Path.**

This prevents an alternate strategy from inheriting incompatible executable assumptions while preserving everything learned.

## Epistemic invariant

Continuity must never turn absence into success.

If evidence cannot establish that an artifact, checkpoint, memory item, resource, or delivery exists, the result remains explicit as pending/unknown/unavailable as appropriate.

No fabricated artifact paths. No inferred successful delivery. No silent replacement of unknown state with defaults.

## Open-world invariant

Core contracts may define stable semantic fields, but must preserve open extension points for newly discovered:

- providers
- executor types
- transports
- artifact schemes
- integrity algorithms
- capability identifiers
- evidence sources
- continuation metadata

Unknown does not mean impossible. Missing current support does not create a global prohibition.

## Current implementation state

Implemented on the execution-continuity branch:

- `ExecutionContinuationContext` with Path-scoped executable state and durable cross-Path knowledge.
- `ContinuityAssembler` as a read-only composer over TaskGraph, Adaptive, mobility, resource, event, and optional contributor authorities.
- explicit continuation delivery through Local, Conway, and AWS without a second provider selector or orchestration authority.
- structured Conway parent -> child Task consumption through Colony Messaging and the canonical harness path.
- canonical parent -> target artifact materialization with target size/hash verification.
- Local filesystem staging, Conway sandbox staging, and AWS SSM staging through their existing executor transports.
- AWS and Conway remote -> parent artifact collection through the canonical lifecycle `collect()` operation.
- authenticated asynchronous `task_result` normalization before TaskGraph persistence, so executor-local paths are collected or remain explicit opaque remote references.
- an integrity manifest attached only as derived delivery evidence; it is not a new artifact ledger.
- open URI/scheme handling: URI-shaped artifact references remain opaque by default, so future schemes do not require a central allowlist.
- end-to-end tests covering logical parent/child continuation, physical Conway artifact return, canonical parent persistence, ContinuityAssembler reconstruction, and rematerialization into a newly registered future target without provider-pair routing.

Still outside the claim of this phase:

- transparent migration of arbitrary live process memory/state.
- guaranteed materialization for a provider that exposes neither a compatible executor materializer nor a provider collection capability; such state remains unavailable/unknown/pending rather than impossible.
- final phase freeze/merge until the exact branch HEAD completes the full CI matrix successfully.

## Result finalization invariant

For asynchronous remote workers the canonical result path is:

```
authenticated task_result
  -> resolve canonical Task + assigned source
  -> EnvironmentExecutionBridge result preparation
  -> EnvironmentResource marks executor-local artifacts pending
  -> EnvironmentLifecycleManager.collect()
  -> provider verifies/collects what it can
  -> parent-safe TaskResult
  -> TaskGraph completion/failure
```

A semantic Task success does not fabricate artifact success. If collection is unavailable or incomplete, the TaskResult preserves an opaque remote reference and the EnvironmentResource remains pending with evidence.

## Phase order

1. Contract + invariants. **Implemented**
2. Tests for contract scoping and open-world behavior. **Implemented**
3. ContinuityAssembler as a read-only composer. **Implemented**
4. Local continuation integration. **Implemented**
5. Conway/AWS delivery integration through existing dispatch paths. **Implemented**
6. Parent -> target artifact materialization + integrity verification. **Implemented**
7. Remote -> parent collection symmetry for AWS/Conway. **Implemented**
8. Cross-environment logical + physical end-to-end continuation tests. **Implemented; final CI validation pending**
9. Architecture audit + phase freeze/merge. **Pending**

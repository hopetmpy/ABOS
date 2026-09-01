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
| AWS remote artifact extraction | AWS provider | `AwsEnvironmentProvider.collect()` | Reuse remote -> parent collection. Missing artifacts remain pending/unknown. |
| Conway task transport | Colony Messaging | `src/orchestration/messaging.ts` | Reuse the existing transport; add continuity payload only through existing dispatch contracts. |
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

## Current verified gaps

At this freeze, the following are not yet implemented as a provider-neutral continuity capability:

- an `ExecutionContinuationContext` contract
- a `ContinuityAssembler`
- explicit continuation injection into Local/Conway/AWS execution
- generic parent -> target artifact materialization
- a provider-neutral artifact integrity manifest

AWS already implements substantial remote -> parent artifact collection. That work must be reused rather than recreated.

## Phase order

1. Contract + invariants.
2. Tests for contract scoping and open-world behavior.
3. ContinuityAssembler as a read-only composer.
4. Local continuation integration.
5. Conway/AWS delivery integration through existing dispatch paths.
6. Parent -> target artifact materialization + integrity verification.
7. Cross-environment end-to-end continuation tests.

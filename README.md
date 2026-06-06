# Conway Everyone-Improving Agent OS

> Sanctuary makes agents sovereign.
> Conway makes sovereign agents useful, improvable, deployable, and economically alive.

> Forge creates possibilities.
> Eval converts possibilities into trust.
> Sanctuary executes under each automaton's constitution.

## What This Is

Conway Agent OS is an **operating system for sovereign automatons**. It provides the operating logic that makes a Sanctuary automaton economically functional: budget consciousness, evaluation, deployment, memory, improvement commons, and contribution rewards.

This is the **v0.1 Local MVP** — a fully runnable local demonstration of the Conway loop using mock providers and a single "Release Scout" automaton vertical.

## What This Is Not

- Not real Sanctuary cryptography (uses mock verifiers)
- Not real cloud deployment (uses mock adapters)
- Not real money movement (uses mock MPP)
- Not a marketplace or multi-tenant SaaS
- Not production infrastructure

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Conway Cockpit (React)                    │
│  Mission │ Budget │ Suggestions │ Live Work │ Memory & Proof    │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                      FastAPI Backend                             │
│                                                                 │
│  Projects │ Agents │ Envelope │ Memory │ Forge │ Eval           │
│  Harness Lab │ Deploy │ Budget │ Receipts │ Rewards │ Authority │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  SQLite DB │ Local Vault │ Mock Sanctuary │ Mock MPP │ Mock CF  │
└─────────────────────────────────────────────────────────────────┘
```

## The Core Loop

```
Observe → Remember → Suggest → Evaluate → Govern → Deploy → Monetize → Receipt → Learn → Reward → Upgrade
```

## Key Concepts

### Automaton Operating Envelope
Each agent has a canonical envelope with roots for all system functions — harness, memory, budget, eval, deploy, rewards, install rings, and more.

### Install Rings (R0–R5)
Permission hierarchy controlling what each capability can do:
- **R0_KNOW** — knowledge only
- **R1_THINK** — prompts, skills, local reasoning
- **R2_READ** — read-only external tools
- **R3_WRITE** — deploy, post, mutate external systems
- **R4_SPEND** — payments, paid APIs, treasury
- **R5_GOVERN** — constitution, privacy, spend policy

### Budget / Reserve / Execute / Settle
Every paid action must reserve budget first. Survival reserve is never touched. Project Governor computes operating mode (GREEN/YELLOW/RED/HIBERNATE/EXIT).

### Private Receipts & Selective Disclosure
Raw receipts are private by default (stored in vault). Public APIs return only summaries and commitment hashes. Visibility ladder: PRIVATE_RAW → EVALUATOR_VIEW → PUBLIC_COMMITMENT.

### Hidden Holdouts
Private eval test cases whose content is never exposed publicly — only pass/fail results are shared.

### Forge
Creates improvements from release observations, packages them as Capability Capsules.

### Eval
Runs deterministic evaluations with rubrics, worldlets (including hidden holdouts), and issues attestations.

### Harness Lab
Patches the agent's harness (prompts, tools, orchestration) with risk classification (LOW/MEDIUM/HIGH/CONSTITUTIONAL).

### Deploy
Deployment capsules → leases → preview → smoke tests → canary → production. Mock Cloudflare adapter.

### Memory
Episodic, semantic, procedural, strategic, financial memory types. Context compiler respects egress policy.

### Contribution Rewards
Usage attestations drive reward routing. Contributors get paid based on manifests. Hard gate failures pay zero.

## Running Locally

```bash
# Install dependencies
make install

# Seed demo data
make seed

# Run tests
make test

# Run full demo loop
make demo

# Start dev servers (backend + frontend)
make dev
```

## Demo Walkthrough

`make demo` runs the full Conway loop:

1. Project exists with mission and budget
2. Release Card discovered (GitHub AI SDK payload change)
3. Improvement Object created (parser may fail)
4. Capability Capsule built (Release Watcher v1.1.0)
5. Harness Patch created (prompt + tool description)
6. Eval runs (ReleaseRadarBench + BuildDeployBench)
7. Eval Attestation issued
8. Suggestions generated and ranked
9. Authority Gate approves (R2_READ, GREEN mode, rollback available)
10. Install Receipt created
11. Deployment Capsule created (Paid AI Release Brief API)
12. BuildDeployBench passes
13. Project Governor approves canary
14. Deployment Lease created
15. Mock deployment (preview + canary)
16. Deployment Receipt stored
17. First mock MPP payment
18. Autonomy Receipt stored privately
19. Memory distillation
20. Forge improvement published (redacted)
21. Usage Attestation created
22. Reward routing (3+ ledger entries)
23. Cockpit shows all metrics

## API Examples

```bash
# Health check
curl http://localhost:8000/health

# List projects
curl http://localhost:8000/v1/projects

# Get budget
curl http://localhost:8000/v1/budget/project/project_release_briefs

# Generate suggestions
curl -X POST http://localhost:8000/v1/suggestions/generate/project_release_briefs

# Run demo
curl -X POST http://localhost:8000/v1/demo/run
```

## Future Work

- Real Sanctuary integration (STC, RRC, VAP, ADSC verification)
- Real cloud deployment (Cloudflare Workers, Fly.io)
- Real MPP settlement
- Multi-agent support
- Multi-project support
- Real eval harnesses
- Real memory embedding & retrieval
- Marketplace for improvements
- NCL/SCL governance committees
- VKL zero-knowledge circuits
- Stake-backed reputation

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { EnvironmentSelector } from "../environments/selector.js";
import { EnvironmentMigrationStore } from "../environments/mobility-store.js";
import { EnvironmentMobilityCoordinator } from "../environments/mobility.js";
import type { EnvironmentExecutionBridge } from "../environments/task-executor.js";
import { createEnvironmentTools } from "../environments/tools.js";
import {
  CREATE_TABLES,
  MIGRATION_V9,
  MIGRATION_V10,
  MIGRATION_V12,
  MIGRATION_V13,
  MIGRATION_V14,
} from "../state/schema.js";

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_TABLES);
  db.exec(MIGRATION_V9);
  db.exec(MIGRATION_V10);
  db.exec(MIGRATION_V12);
  db.exec(MIGRATION_V13);
  db.exec(MIGRATION_V14);
  return db;
}

describe("environment lifecycle agent tools", () => {
  it("exposes ranked environment selection evidence to the agent", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      id: "zero-cost",
      inspect: async () => ({
        id: "zero-cost",
        label: "Zero cost",
        availability: "available",
        capabilities: [{
          id: "zero-cost:compute",
          type: "executor",
          provider: "zero-cost",
          description: "compute",
          requirements: ["compute"],
          permissions: [],
          environment: "zero-cost",
          available: true,
        }],
        evidence: ["ready"],
        constraints: [],
        observedAt: new Date().toISOString(),
      }),
      estimate: async () => ({
        estimatedCostCents: 0,
        costCoverage: "complete",
        reliability: 0.9,
      }),
    });

    const tools = createEnvironmentTools(registry, {
      selector: new EnvironmentSelector(registry),
    });
    const select = tools.find((tool) => tool.name === "environment_select");
    expect(select).toBeDefined();

    const result = await select!.execute({
      required_capabilities: ["compute"],
      max_estimated_cost_cents: 10,
    }, {} as any);

    const parsed = JSON.parse(result);
    expect(parsed.selected.environment).toBe("zero-cost");
    expect(parsed.selected.executionEligible).toBe(true);
    expect(parsed.candidates).toHaveLength(1);
  });

  it("exposes non-destructive mobility planning and durable migration evidence", async () => {
    const db = createDb();
    try {
      let mutations = 0;
      const registry = new EnvironmentRegistry();
      for (const id of ["source-provider", "target-provider"]) {
        registry.register({
          id,
          inspect: async () => ({
            id,
            label: id,
            availability: "available",
            capabilities: [{
              id: `${id}:compute`,
              type: "executor",
              provider: id,
              description: "compute",
              requirements: ["compute"],
              permissions: [],
              environment: id,
              available: true,
            }],
            evidence: [],
            constraints: [],
            observedAt: new Date().toISOString(),
          }),
          estimate: async () => ({
            estimatedCostCents: 0,
            costCoverage: "complete",
            reliability: 0.9,
          }),
          provision: async () => {
            mutations += 1;
            return { externalId: "unexpected" };
          },
          destroy: async () => {
            mutations += 1;
            return { status: "terminated" };
          },
        });
      }

      const resources = new EnvironmentResourceStore(db);
      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        resources,
      );
      const source = lifecycle.adopt({
        provider: "source-provider",
        externalId: "source-resource",
        type: "executor",
        status: "running",
        capabilities: ["compute"],
        retentionPolicy: "manual_retention",
      });
      const selector = new EnvironmentSelector(registry);
      const mobility = new EnvironmentMobilityCoordinator(
        registry,
        selector,
        lifecycle,
        new EnvironmentMigrationStore(db),
        {} as EnvironmentExecutionBridge,
      );
      const tools = createEnvironmentTools(registry, {
        selector,
        lifecycle,
        getMobility: () => mobility,
      });
      const planTool = tools.find(
        (tool) => tool.name === "environment_migration_plan",
      )!;
      const listTool = tools.find(
        (tool) => tool.name === "environment_migrations",
      )!;

      const plan = JSON.parse(
        await planTool.execute({
          source_resource_id: source.id,
          reason: "continue on a distinct resource route",
          required_capabilities: ["compute"],
          preferred_environment: "target-provider",
          max_estimated_cost_cents: 10,
        }, {} as any),
      );

      expect(plan.selection.selected.environmentId).toBe(
        "target-provider",
      );
      expect(plan.excludedResourceIds).toEqual([source.id]);
      expect(plan.excludedEnvironmentIds).toEqual([]);
      expect(mutations).toBe(0);

      const migrations = JSON.parse(
        await listTool.execute({ active_only: true }, {} as any),
      );
      expect(migrations).toHaveLength(1);
      expect(migrations[0].sourceResourceId).toBe(source.id);
      expect(migrations[0].targetProvider).toBe("target-provider");
      expect(mutations).toBe(0);
    } finally {
      db.close();
    }
  });

  it("lists, health-checks and reconciles persisted resources", async () => {
    const db = createDb();
    try {
      const registry = new EnvironmentRegistry();
      registry.register({
        id: "tracked-provider",
        inspect: async () => ({
          id: "tracked-provider",
          label: "Tracked",
          availability: "available",
          capabilities: [],
          evidence: [],
          constraints: [],
          observedAt: new Date().toISOString(),
        }),
        health: async () => ({
          healthy: true,
          status: "running",
          evidence: ["resource healthy"],
        }),
        reconcile: async (resource) => ({
          resource: {
            ...resource,
            status: "running",
            providerState: "observed",
            updatedAt: new Date().toISOString(),
          },
          actualExists: true,
          action: "none",
          evidence: ["resource observed"],
        }),
      });

      const store = new EnvironmentResourceStore(db);
      const lifecycle = new EnvironmentLifecycleManager(registry, store);
      const resource = lifecycle.adopt({
        provider: "tracked-provider",
        externalId: "external-1",
        type: "compute",
        status: "unknown",
      });

      const tools = createEnvironmentTools(registry, { lifecycle });
      const list = tools.find((tool) => tool.name === "environment_resources")!;
      const health = tools.find((tool) => tool.name === "environment_health")!;
      const reconcile = tools.find((tool) => tool.name === "environment_reconcile")!;

      const listed = JSON.parse(await list.execute({}, {} as any));
      expect(listed[0].id).toBe(resource.id);

      const healthy = JSON.parse(await health.execute(
        { resource_id: resource.id },
        {} as any,
      ));
      expect(healthy.status).toBe("running");
      expect(healthy.lastHealthCheck).not.toBeNull();

      const reconciled = JSON.parse(await reconcile.execute(
        { resource_id: resource.id },
        {} as any,
      ));
      expect(reconciled.status).toBe("running");
      expect(reconciled.providerState).toBe("observed");
    } finally {
      db.close();
    }
  });
});

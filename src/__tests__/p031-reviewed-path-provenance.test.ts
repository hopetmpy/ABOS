import { describe, expect, it } from "vitest";
import { AdaptiveStore } from "../intelligence/store.js";
import { getReviewedTaskPathReceipt } from "../orchestration/orchestrator.js";
import { insertGoal, insertTask } from "../state/database.js";
import { createTestDb } from "./mocks.js";

describe("P-025 reviewed route provenance for P-031", () => {
  it("requires exact canonical materialized-path receipt, task binding and selected status", () => {
    const db = createTestDb();
    try {
      const goalId = insertGoal(db.raw, {
        title: "Business deployment", description: "Deploy an actual SaaS",
      });
      const taskId = insertTask(db.raw, {
        goalId, title: "Acquire compute", description: "Compare reuse and EC2",
      });
      const store = new AdaptiveStore(db.raw);
      const path = store.getOrCreatePath({
        goalId, hypothesis: "Compute enables delivery",
        strategy: "reuse, then provider economic check",
        assumptions: ["account is authorized"],
        requiredCapabilities: ["remote compute"], sequence: ["review", "deploy"],
        expectedOutcome: "service running",
      });
      store.bindTask({ taskId, goalId, pathId: path.id });
      store.setPathStatus(path.id, "selected");

      // P-018/AdaptiveStore selected path alone is NOT proof of P-025 review.
      expect(getReviewedTaskPathReceipt(db.raw, taskId)).toBeNull();
      db.raw.prepare(
        "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
      ).run(`orchestrator.review_feedback.${goalId}`,
        `reviewed and materialized; materialized_path=${path.id}`);
      const receipt = getReviewedTaskPathReceipt(db.raw, taskId);
      expect(receipt).toMatchObject({ goalId, taskId, pathId: path.id });
      expect(receipt?.evidence.join(" ")).toContain("NOT");
    } finally {
      db.close();
    }
  });

  it("rejects stale or unrelated review receipts and stale task routes", () => {
    const db = createTestDb();
    try {
      const goalId = insertGoal(db.raw, {
        title: "Another goal", description: "Make service",
      });
      const taskId = insertTask(db.raw, {
        goalId, title: "Acquire compute", description: "Evaluate options",
      });
      const store = new AdaptiveStore(db.raw);
      const path = store.getOrCreatePath({
        goalId, hypothesis: "Necessary capacity",
        strategy: "reviewed compute route",
        assumptions: [], requiredCapabilities: [],
        sequence: ["acquire"], expectedOutcome: "capacity",
      });
      store.bindTask({ taskId, goalId, pathId: path.id });
      store.setPathStatus(path.id, "selected");
      const saveFeedback = (text: string) => db.raw.prepare(
        "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
      ).run(`orchestrator.review_feedback.${goalId}`, text);
      saveFeedback("materialized_path=another-path");
      expect(getReviewedTaskPathReceipt(db.raw, taskId)).toBeNull();
      saveFeedback(`materialized_path=${path.id} trailing unsupported`);
      expect(getReviewedTaskPathReceipt(db.raw, taskId)).toBeNull();
      saveFeedback(`approved; materialized_path=${path.id}`);
      db.raw.prepare("UPDATE task_graph SET status = 'cancelled' WHERE id = ?")
        .run(taskId);
      expect(getReviewedTaskPathReceipt(db.raw, taskId)).toBeNull();
    } finally {
      db.close();
    }
  });
});
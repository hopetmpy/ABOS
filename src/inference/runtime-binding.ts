/**
 * Live model binding.
 *
 * Watches abos.json cheaply via mtime and refreshes only the model-strategy
 * projection needed by the inference router. This makes model changes visible
 * on the next inference turn without rebuilding the runtime.
 */

import fs from "node:fs";
import { getConfigPath, loadConfig } from "../config.js";
import {
  DEFAULT_MODEL_STRATEGY_CONFIG,
  type ModelStrategyConfig,
} from "../types.js";

export class RuntimeModelBinding {
  private lastMtimeMs = -1;
  private current: ModelStrategyConfig;

  constructor(initial: ModelStrategyConfig) {
    this.current = { ...initial };
  }

  refresh(): ModelStrategyConfig {
    const configPath = getConfigPath();
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(configPath).mtimeMs;
    } catch {
      return { ...this.current };
    }

    if (mtimeMs === this.lastMtimeMs) return { ...this.current };
    this.lastMtimeMs = mtimeMs;

    const live = loadConfig();
    if (!live) return { ...this.current };

    this.current = {
      ...DEFAULT_MODEL_STRATEGY_CONFIG,
      ...(live.modelStrategy ?? {}),
      inferenceModel: live.inferenceModel || live.modelStrategy?.inferenceModel || this.current.inferenceModel,
      maxTokensPerTurn: live.maxTokensPerTurn || live.modelStrategy?.maxTokensPerTurn || this.current.maxTokensPerTurn,
    };

    return { ...this.current };
  }
}

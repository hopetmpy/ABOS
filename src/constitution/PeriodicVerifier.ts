import type { AgentEventBus } from "../events/agentEventBus.js";
import { sha256Hex } from "../replication/buildReplicationPayload.js";
import {
  hourBucket,
  publishConstitutionAlert,
  type ConstitutionAlertTenant,
} from "./alerts.js";

export interface PeriodicVerifierOptions {
  expectedHash: string;
  readConstitution: () => string | Promise<string>;
  bus: AgentEventBus;
  tenant: ConstitutionAlertTenant;
  intervalMs?: number;
  now?: () => Date;
}

export interface PeriodicVerifierTickResult {
  checked: true;
  valid: boolean;
  observedHash: string;
  published: boolean;
}

const MAX_DEDUPE_ENTRIES = 24;

export class PeriodicVerifier {
  readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly dedupeOrder: string[] = [];
  private readonly dedupeEntries = new Set<string>();

  constructor(private readonly options: PeriodicVerifierOptions) {
    this.intervalMs = options.intervalMs ?? 60_000;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }

  getDedupeEntryCount(): number {
    return this.dedupeEntries.size;
  }

  private rememberDedupeKey(dedupeKey: string): boolean {
    if (this.dedupeEntries.has(dedupeKey)) {
      return false;
    }

    this.dedupeEntries.add(dedupeKey);
    this.dedupeOrder.push(dedupeKey);

    while (this.dedupeOrder.length > MAX_DEDUPE_ENTRIES) {
      const expired = this.dedupeOrder.shift();
      if (expired) {
        this.dedupeEntries.delete(expired);
      }
    }

    return true;
  }

  async tick(now: Date = this.options.now?.() ?? new Date()): Promise<PeriodicVerifierTickResult> {
    const content = await this.options.readConstitution();
    const observedHash = sha256Hex(content);

    if (observedHash === this.options.expectedHash) {
      return {
        checked: true,
        valid: true,
        observedHash,
        published: false,
      };
    }

    const dedupeKey = [
      "constitution.tamper.runtime",
      this.options.tenant.agentId,
      observedHash,
      hourBucket(now),
    ].join(":");

    if (!this.rememberDedupeKey(dedupeKey)) {
      return {
        checked: true,
        valid: false,
        observedHash,
        published: false,
      };
    }

    const { published } = await publishConstitutionAlert({
      bus: this.options.bus,
      tenant: this.options.tenant,
      severity: "P0",
      category: "constitution.tamper.runtime",
      title: "Constitution runtime drift detected",
      details: `expected=${this.options.expectedHash} observed=${observedHash} rule=none`,
      dedupeKey,
      now,
    });

    return {
      checked: true,
      valid: false,
      observedHash,
      published,
    };
  }
}

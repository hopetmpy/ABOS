import { describe, expect, it } from "vitest";
import {
  classifyCreditTransferStatus,
  isCreditTransferAccepted,
} from "../conway/credits.js";

describe("P-030 credit transfer status classification", () => {
  it.each([
    "settled",
    "completed",
    "complete",
    "succeeded",
    "success",
    "confirmed",
  ])("classifies explicit final provider status %s as settled", (status) => {
    expect(classifyCreditTransferStatus(status)).toBe("settled");
    expect(isCreditTransferAccepted(status)).toBe(true);
  });

  it.each([
    "submitted",
    "processing",
    "pending",
    "queued",
    "accepted",
    "received",
  ])("keeps intermediate provider status %s pending", (status) => {
    expect(classifyCreditTransferStatus(status)).toBe("pending");
    expect(isCreditTransferAccepted(status)).toBe(false);
  });

  it.each([
    "failed",
    "error",
    "rejected",
    "declined",
    "cancelled",
    "denied",
    "invalid_request",
  ])("classifies explicit negative provider status %s as rejected", (status) => {
    expect(classifyCreditTransferStatus(status)).toBe("rejected");
    expect(isCreditTransferAccepted(status)).toBe(false);
  });

  it.each(["", "   ", "future_provider_state", "awaiting_external_finality"])(
    "preserves unrecognized provider status %s as unknown",
    (status) => {
      expect(classifyCreditTransferStatus(status)).toBe("unknown");
      expect(isCreditTransferAccepted(status)).toBe(false);
    },
  );

  it("preserves nullish status as unknown", () => {
    expect(classifyCreditTransferStatus(null)).toBe("unknown");
    expect(classifyCreditTransferStatus(undefined)).toBe("unknown");
  });

  it("does not let a positive-looking substring override explicit rejection", () => {
    expect(classifyCreditTransferStatus("success_then_rejected")).toBe(
      "rejected",
    );
  });
});

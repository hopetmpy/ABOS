/**
 * Parent-Child Messaging
 *
 * Relay-based communication between parent and child automatons.
 * Replaces unauthenticated filesystem-based messageChild().
 */

import type { SocialClientInterface, ParentChildMessage } from "../types.js";
import { MESSAGE_LIMITS } from "../types.js";
import { ulid } from "ulid";
import { SAFE_MODE, SafeModeViolation } from "../safety/safe-mode.js";
import { RESTRICTED_LIVE_MODE, RestrictedLiveViolation } from "../restricted-live/mode.js";

/**
 * Send a message to a child via the social relay.
 */
export async function sendToChild(
  social: SocialClientInterface,
  childAddress: string,
  content: string,
  type: string = "parent_message",
): Promise<{ id: string }> {
  if (SAFE_MODE) throw new SafeModeViolation("messaging", "send message to child", "replication/messaging");
  if (RESTRICTED_LIVE_MODE) throw new RestrictedLiveViolation("MESSAGING_DENIED", "Replication messaging is disabled in restricted-live mode");
  if (content.length > MESSAGE_LIMITS.maxContentLength) {
    throw new Error(`Message too long: ${content.length} bytes (max ${MESSAGE_LIMITS.maxContentLength})`);
  }

  const result = await social.send(childAddress, JSON.stringify({
    type,
    content,
    sentAt: new Date().toISOString(),
  }));

  return { id: result.id };
}

/**
 * Send a message to the parent via the social relay.
 */
export async function sendToParent(
  social: SocialClientInterface,
  parentAddress: string,
  content: string,
  type: string = "child_message",
): Promise<{ id: string }> {
  if (SAFE_MODE) throw new SafeModeViolation("messaging", "send message to parent", "replication/messaging");
  if (RESTRICTED_LIVE_MODE) throw new RestrictedLiveViolation("MESSAGING_DENIED", "Replication messaging is disabled in restricted-live mode");
  if (content.length > MESSAGE_LIMITS.maxContentLength) {
    throw new Error(`Message too long: ${content.length} bytes (max ${MESSAGE_LIMITS.maxContentLength})`);
  }

  const result = await social.send(parentAddress, JSON.stringify({
    type,
    content,
    sentAt: new Date().toISOString(),
  }));

  return { id: result.id };
}

/**
 * Shared Timestamp Reference Handler
 *
 * This module provides timestamp reference resolution functionality
 * that is shared across multiple domains.
 */

import type { ReferenceHandler } from "../handlers.js";
import { extractTimelineTimestamps } from "../incident/referenceHandler.js";

/**
 * Reference handler for timestamp-related references
 *
 * Resolves references like "since then", "before that", etc.
 */
export const timestampReferenceHandler: ReferenceHandler = async (
  context,
  referenceText,
): Promise<string | null> => {
  // Extract timestamps from incident timeline using the incident handler
  const timestampEntities = extractTimelineTimestamps(context.conversationHistory);

  if (timestampEntities.length === 0) {
    return null;
  }

  // Sort by recency
  timestampEntities.sort((a, b) => b.timestamp - a.timestamp);

  const baseTime = timestampEntities[0].value;

  // Handle different reference types
  if (
    referenceText.includes("since then") ||
    referenceText.includes("after that")
  ) {
    return baseTime;
  } else if (referenceText.includes("before that")) {
    // Return 1 hour before the base time
    const baseMs = new Date(baseTime).getTime();
    const beforeMs = baseMs - 60 * 60 * 1000; // 1 hour before
    return new Date(beforeMs).toISOString();
  }

  return baseTime;
};

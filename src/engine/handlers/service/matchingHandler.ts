/**
 * Service Matching Handler
 *
 * Performs fuzzy matching of service names from questions.
 * Extracted from serviceDiscovery.ts to follow handler-based architecture.
 */

import type { ServiceMatchingHandler } from "../handlers.js";

/**
 * Service matching handler that performs fuzzy matching of service names from questions
 */
export const serviceMatchingHandler: ServiceMatchingHandler = async (
  context,
  question,
  knownServices,
): Promise<string | null> => {
  return matchServiceFromQuestion(question, knownServices);
};

/**
 * Fuzzy match a service name from a question against known services.
 * Handles cases like "identity one" -> "svc-identity" or "payments" -> "payments-svc"
 *
 * Extracted from serviceDiscovery.ts
 */
export function matchServiceFromQuestion(
  question: string,
  knownServices: string[],
): string | null {
  const normalized = question.toLowerCase();

  // 1. Exact match
  for (const service of knownServices) {
    if (normalized.includes(service.toLowerCase())) {
      return service;
    }
  }

  // 2. Word-based matching - extract significant words from question
  const genericTerms = [
    "service",
    "svc",
    "api",
    "app",
    "application",
    "system",
    "platform",
    "backend",
    "frontend",
    "one",
    "two",
    "three",
    "four",
    "five",
    "the",
    "a",
    "an",
    "about",
    "tell",
    "me",
    "more",
  ];
  const stopWords = [
    "the",
    "a",
    "an",
    "last",
    "past",
    "this",
    "that",
    "what",
    "which",
    "when",
    "where",
    "show",
    "get",
    "give",
    "tell",
    "me",
    "more",
    "about",
    "for",
    "in",
    "on",
  ];

  const questionWords = normalized
    .split(/\W+/)
    .filter((w) => w.length > 2 && !stopWords.includes(w));

  // For each known service, calculate a match score
  const serviceScores: Array<{ service: string; score: number }> = [];

  for (const service of knownServices) {
    const serviceLower = service.toLowerCase();
    const serviceParts = serviceLower.split(/[-_]/);
    const significantParts = serviceParts.filter(
      (p) => p.length > 2 && !genericTerms.includes(p),
    );

    let score = 0;
    let matchedSignificant = false;

    // Score based on how many significant question words match service parts
    for (const word of questionWords) {
      // Exact match with a service part
      if (significantParts.some((p) => p === word)) {
        score += 10;
        matchedSignificant = true;
        continue;
      }

      // Stemming: "payments" -> "payment"
      const stem = word.endsWith("s") ? word.slice(0, -1) : word;
      if (
        significantParts.some((p) => p === stem || stem === p.replace(/s$/, ""))
      ) {
        score += 8;
        matchedSignificant = true;
        continue;
      }

      // Partial match: "identity" in "svc-identity"
      if (significantParts.some((p) => p.includes(word) || word.includes(p))) {
        score += 5;
        matchedSignificant = true;
      }

      // Full service name contains the word
      if (serviceLower.includes(word)) {
        score += 3;
      }
    }

    // Bonus for matching generic parts if they appear in question
    const genericParts = serviceParts.filter((p) => genericTerms.includes(p));
    for (const part of genericParts) {
      if (normalized.includes(part)) {
        score += 2;
      }
    }

    if (score > 0 && (matchedSignificant || significantParts.length === 0)) {
      serviceScores.push({ service, score });
    }
  }

  // Return the highest scoring service if score is high enough
  if (serviceScores.length > 0) {
    serviceScores.sort((a, b) => b.score - a.score);
    const best = serviceScores[0];

    // Require at least a score of 5 (one partial match) to return a result
    if (best.score >= 5) {
      console.log(
        `[ServiceMatching] Matched "${question}" to service "${best.service}" (score: ${best.score})`,
      );
      return best.service;
    }
  }

  return null;
}

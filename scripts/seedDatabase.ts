#!/usr/bin/env node
/**
 * Database seeding script for OpsOrch Copilot
 * Populates the conversation database with realistic operational conversations
 */

import { SqliteConversationStore } from "../src/stores/sqliteConversationStore.js";
import { Conversation, ConversationTurn } from "../src/types.js";
import { randomUUID } from "crypto";

const DB_PATH = "./data/conversations.db";
const CONVERSATION_COUNT = 30;

// Realistic service names with prefixes
const SERVICE_PREFIXES = ["svc-", "api-", "service-"];
const SERVICE_NAMES = [
  "identity",
  "auth",
  "payment",
  "user",
  "notification",
  "order",
  "inventory",
  "search",
  "analytics",
  "billing",
  "email",
  "cache",
  "database",
  "storage",
  "cdn",
  "logging",
  "checkout",
  "cart",
  "recommendation",
  "fraud-detection",
];

function generateServiceName(): string {
  const prefix = randomChoice(SERVICE_PREFIXES);
  const name = randomChoice(SERVICE_NAMES);
  return `${prefix}${name}`;
}

function generateTimestamp(daysBack: number): number {
  const now = Date.now();
  const daysInMs = daysBack * 24 * 60 * 60 * 1000;
  return now - Math.floor(Math.random() * daysInMs);
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateIncidentId(): string {
  return `INC-${Math.floor(10000 + Math.random() * 90000)}`;
}


interface ConversationTemplate {
  name: (service: string) => string;
  turns: (service: string, timestamp: number) => ConversationTurn[];
}

// Simplified conversation templates
const TEMPLATES: ConversationTemplate[] = [
  // Latency incident investigation
  {
    name: (service: string) =>
      `Latency incident affecting ${service} for mobile logins`,
    turns: (service: string, timestamp: number): ConversationTurn[] => {
      const incidentId = generateIncidentId();
      return [
        {
          userMessage: `What's happening with ${service}? Getting reports of slow mobile logins`,
          assistantResponse: `I found an active incident ${incidentId} affecting ${service}. The p95 latency has spiked to 1100ms (normal is 180ms). The issue started about 2 hours ago and is affecting mobile auth endpoints.`,
          timestamp,
          entities: [
            {
              type: "incident",
              value: incidentId,
              extractedAt: timestamp,
              source: "query-incidents",
            },
            {
              type: "service",
              value: service,
              extractedAt: timestamp,
              source: "question",
            },
          ],
        },
        {
          userMessage: "What's causing the latency?",
          assistantResponse: `Based on the logs and metrics, the latency spike correlates with a deployment that went out 2 hours ago. The new code path is making additional database calls that are causing the slowdown.`,
          timestamp: timestamp + 5 * 60 * 1000,
          entities: [],
        },
      ];
    },
  },
  // Error rate investigation
  {
    name: (service: string) => `Error rate spike in ${service}`,
    turns: (service: string, timestamp: number): ConversationTurn[] => {
      const incidentId = generateIncidentId();
      return [
        {
          userMessage: `Why is ${service} throwing so many 500 errors?`,
          assistantResponse: `I found that ${service} error rate jumped to 15% about 30 minutes ago. The errors are primarily coming from the /api/checkout endpoint. Looking at the logs, it appears to be a database connection pool exhaustion issue.`,
          timestamp,
          entities: [
            {
              type: "service",
              value: service,
              extractedAt: timestamp,
              source: "question",
            },
          ],
        },
        {
          userMessage: "Is there an incident for this?",
          assistantResponse: `Yes, incident ${incidentId} was automatically created 25 minutes ago. The on-call engineer has been paged and is investigating.`,
          timestamp: timestamp + 3 * 60 * 1000,
          entities: [
            {
              type: "incident",
              value: incidentId,
              extractedAt: timestamp + 3 * 60 * 1000,
              source: "query-incidents",
            },
          ],
        },
      ];
    },
  },
  // Deployment investigation
  {
    name: (service: string) => `Recent deployment issues with ${service}`,
    turns: (service: string, timestamp: number): ConversationTurn[] => {
      return [
        {
          userMessage: `What deployments happened to ${service} today?`,
          assistantResponse: `There were 3 deployments to ${service} today:\n1. v2.3.1 at 09:15 - Config update\n2. v2.3.2 at 14:30 - Bug fix for auth flow\n3. v2.3.3 at 16:45 - Performance optimization`,
          timestamp,
          entities: [
            {
              type: "service",
              value: service,
              extractedAt: timestamp,
              source: "question",
            },
            {
              type: "deployment",
              value: "v2.3.3",
              extractedAt: timestamp,
              source: "query-deployments",
            },
          ],
        },
      ];
    },
  },
  // Log investigation
  {
    name: (service: string) => `Log analysis for ${service}`,
    turns: (service: string, timestamp: number): ConversationTurn[] => {
      return [
        {
          userMessage: `Show me error logs from ${service} in the last hour`,
          assistantResponse: `Found 47 error logs from ${service} in the last hour. The most common errors are:\n- Connection timeout (23 occurrences)\n- Invalid token (15 occurrences)\n- Rate limit exceeded (9 occurrences)`,
          timestamp,
          entities: [
            {
              type: "service",
              value: service,
              extractedAt: timestamp,
              source: "question",
            },
          ],
        },
      ];
    },
  },
  // Metric query
  {
    name: (service: string) => `Metrics review for ${service}`,
    turns: (service: string, timestamp: number): ConversationTurn[] => {
      return [
        {
          userMessage: `What's the current CPU and memory usage for ${service}?`,
          assistantResponse: `Current resource usage for ${service}:\n- CPU: 67% (normal range: 40-60%)\n- Memory: 82% (normal range: 60-75%)\n- Pod count: 8/10 healthy\n\nMemory usage is elevated, which may indicate a memory leak.`,
          timestamp,
          entities: [
            {
              type: "service",
              value: service,
              extractedAt: timestamp,
              source: "question",
            },
          ],
        },
      ];
    },
  },
];

async function seedDatabase(): Promise<void> {
  console.log(`Seeding database at ${DB_PATH}...`);

  const store = new SqliteConversationStore(
    {
      maxConversations: 1000,
      maxTurnsPerConversation: 50,
      conversationTTLMs: 90 * 24 * 60 * 60 * 1000, // 90 days
    },
    DB_PATH,
  );

  // Clear existing data
  await store.clear();

  const conversations: Conversation[] = [];

  for (let i = 0; i < CONVERSATION_COUNT; i++) {
    const template = randomChoice(TEMPLATES);
    const service = generateServiceName();
    const timestamp = generateTimestamp(30);

    const conversation: Conversation = {
      chatId: randomUUID(),
      name: template.name(service),
      turns: template.turns(service, timestamp),
      createdAt: timestamp,
      lastAccessedAt: timestamp + Math.floor(Math.random() * 60 * 60 * 1000),
    };

    conversations.push(conversation);
  }

  // Sort by lastAccessedAt descending
  conversations.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);

  // Save all conversations
  for (const conv of conversations) {
    await store.set(conv.chatId, conv);
  }

  console.log(`Seeded ${conversations.length} conversations`);

  // Close the store
  await store.close();
}

seedDatabase().catch(console.error);

#!/usr/bin/env node
/**
 * Database seeding script for OpsOrch Copilot
 * Populates the conversation database with realistic operational conversations
 */

import { SqliteConversationStore } from '../src/stores/sqliteConversationStore.js';
import { Conversation, ConversationTurn } from '../src/types.js';
import { randomUUID } from 'crypto';

const DB_PATH = './data/conversations.db';
const CONVERSATION_COUNT = 30;

// Realistic service names with prefixes
const SERVICE_PREFIXES = ['svc-', 'api-', 'service-'];
const SERVICE_NAMES = [
  'identity', 'auth', 'payment', 'user', 'notification', 'order',
  'inventory', 'search', 'analytics', 'billing', 'email', 'cache',
  'database', 'storage', 'cdn', 'logging', 'checkout', 'cart',
  'recommendation', 'fraud-detection'
];

function generateServiceName(): string {
  const prefix = randomChoice(SERVICE_PREFIXES);
  const name = randomChoice(SERVICE_NAMES);
  return `${prefix}${name}`;
}

// Generate realistic timestamps over the last 30 days
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

function generateTicketId(): string {
  return `TICK-${Math.floor(1000 + Math.random() * 9000)}`;
}

// Conversation templates with realistic operational detail
const TEMPLATES = [
  // Auth latency incident (like the example)
  {
    name: (service: string) => `Latency incident affecting ${service} for mobile logins`,
    turns: (service: string, timestamp: number): ConversationTurn[] => {
      const incidentId = generateIncidentId();
      const incidentTime = new Date(timestamp);
      const mitigationTime = new Date(timestamp + 3 * 60 * 60 * 1000); // 3 hours later

      return [
        {
          userMessage: `What's happening with ${service}? Getting reports of slow mobile logins`,
          toolResults: [
            {
              name: 'get_service_metrics',
              result: {
                service,
                environment: 'prod',
                latency_p95: 1100,
                latency_p99: 2340,
                normal_p95: 180,
                error_rate: 3.2,
                spike_start: incidentTime.toISOString(),
                affected_endpoints: ['/api/v2/auth/mobile', '/api/v2/auth/token']
              }
            },
            {
              name: 'get_incidents',
              result: {
                incidents: [{
                  id: incidentId,
                  title: `${service} latency spike affecting mobile auth`,
                  severity: 'HIGH',
                  status: 'investigating',
                  created_at: incidentTime.toISOString(),
                  affected_services: [service],
                  environment: 'prod'
                }]
              }
            }
          ],
          assistantResponse: `There's a recent latency incident affecting the ${service} for mobile logins in prod. P95 auth latency reached 1.1s around ${incidentTime.toISOString().split('.')[0]} UTC, up from the normal 180ms baseline. The incident ${incidentId} was created and is currently in 'investigating' status. The spike is primarily affecting the /api/v2/auth/mobile and /api/v2/auth/token endpoints.`,
          timestamp,
          entities: [
            { type: 'service', value: service, extractedAt: timestamp, source: 'user_message' },
            { type: 'incident', value: incidentId, extractedAt: timestamp, source: 'tool_result' },
            { type: 'timestamp', value: incidentTime.toISOString(), extractedAt: timestamp, source: 'tool_result' }
          ]
        },
        {
          userMessage: 'What mitigation actions have been taken?',
          toolResults: [
            {
              name: 'get_incident_timeline',
              result: {
                incident_id: incidentId,
                events: [
                  {
                    timestamp: new Date(timestamp + 30 * 60 * 1000).toISOString(),
                    action: 'rollback',
                    description: 'Rolled back deployment v2.8.3 to v2.8.2',
                    actor: 'oncall-engineer'
                  },
                  {
                    timestamp: new Date(timestamp + 90 * 60 * 1000).toISOString(),
                    action: 'config_change',
                    description: 'Increased Redis connection pool from 50 to 100',
                    actor: 'sre-team'
                  },
                  {
                    timestamp: mitigationTime.toISOString(),
                    action: 'status_update',
                    description: 'Latency normalizing, monitoring for stability',
                    actor: 'incident-commander'
                  }
                ]
              }
            }
          ],
          assistantResponse: `Several mitigation actions have been applied:\n1. Rollback of deployment v2.8.3 to v2.8.2 (30 minutes after incident start)\n2. Redis connection pool increased from 50 to 100 connections (90 minutes in)\n3. As of ${mitigationTime.toISOString().split('.')[0]} UTC, latency is reported as normalizing\n\nThe incident is currently in 'mitigating' status and the team is monitoring for stability.`,
          timestamp: timestamp + 180 * 60 * 1000,
          entities: [
            { type: 'incident', value: incidentId, extractedAt: timestamp + 180 * 60 * 1000, source: 'tool_result' },
            { type: 'timestamp', value: mitigationTime.toISOString(), extractedAt: timestamp + 180 * 60 * 1000, source: 'tool_result' }
          ]
        },
        {
          userMessage: 'What is the current health status?',
          toolResults: [
            {
              name: 'get_service_status',
              result: {
                service,
                status: 'ok',
                health_score: 0.94,
                latency_p95: 195,
                error_rate: 0.8,
                last_check: mitigationTime.toISOString()
              }
            }
          ],
          assistantResponse: `Current health is reported as ok. P95 latency has returned to 195ms (near the 180ms baseline), and error rate is down to 0.8%. Health score is 0.94. The mitigation actions appear to have been effective.`,
          timestamp: timestamp + 185 * 60 * 1000,
          entities: [
            { type: 'service', value: service, extractedAt: timestamp + 185 * 60 * 1000, source: 'user_message' }
          ]
        }
      ];
    }
  },
  // Database connection pool exhaustion with detailed investigation
  {
    name: (service: string) => `Connection pool exhaustion in ${service}`,
    turns: (service: string, timestamp: number): ConversationTurn[] => {
      const incidentTime = new Date(timestamp);

      return [
        {
          userMessage: `${service} is throwing a lot of database timeout errors, what's going on?`,
          toolResults: [
            {
              name: 'query_logs',
              result: {
                service,
                time_range: '15m',
                error_count: 2847,
                top_errors: [
                  {
                    message: 'ConnectionPoolTimeoutException: Timeout waiting for connection from pool',
                    count: 1923,
                    first_seen: new Date(timestamp - 15 * 60 * 1000).toISOString()
                  },
                  {
                    message: 'SQLTransientConnectionException: Connection is not available',
                    count: 724,
                    first_seen: new Date(timestamp - 12 * 60 * 1000).toISOString()
                  }
                ],
                error_rate_per_min: 189
              }
            },
            {
              name: 'get_service_metrics',
              result: {
                service,
                db_pool_size: 75,
                db_pool_active: 75,
                db_pool_idle: 0,
                db_pool_wait_time_ms: 4200,
                db_pool_wait_count: 1847
              }
            }
          ],
          assistantResponse: `${service} has exhausted its database connection pool. All 75 connections are active with 0 idle, and 1,847 requests are waiting an average of 4.2 seconds for a connection. This started about 15 minutes ago and is causing 189 errors per minute. The pool exhaustion is the root cause of the timeout errors.`,
          timestamp,
          entities: [
            { type: 'service', value: service, extractedAt: timestamp, source: 'user_message' },
            { type: 'timestamp', value: incidentTime.toISOString(), extractedAt: timestamp, source: 'tool_result' }
          ]
        },
        {
          userMessage: 'Is there a traffic spike or connection leak?',
          toolResults: [
            {
              name: 'get_service_metrics',
              result: {
                service,
                request_rate_current: 1240,
                request_rate_1h_ago: 1180,
                request_rate_24h_avg: 1150,
                db_connection_lifetime_avg_sec: 340,
                db_connection_lifetime_p95_sec: 890,
                normal_connection_lifetime_sec: 45
              }
            }
          ],
          assistantResponse: `Traffic is only slightly elevated (1,240 req/min vs 1,150 avg), so this isn't a traffic spike. However, there's a clear connection leak: average connection lifetime is 340 seconds with P95 at 890 seconds, compared to the normal 45 seconds. Connections aren't being properly closed or returned to the pool.`,
          timestamp: timestamp + 120000,
          entities: [
            { type: 'service', value: service, extractedAt: timestamp + 120000, source: 'user_message' }
          ]
        },
        {
          userMessage: 'Check recent deployments',
          toolResults: [
            {
              name: 'get_deployment_history',
              result: {
                service,
                recent_deployments: [
                  {
                    version: 'v3.2.1',
                    deployed_at: new Date(timestamp - 45 * 60 * 1000).toISOString(),
                    status: 'active',
                    changes: ['Added async batch processing for user exports', 'Updated ORM to v5.2.0']
                  },
                  {
                    version: 'v3.2.0',
                    deployed_at: new Date(timestamp - 72 * 60 * 60 * 1000).toISOString(),
                    status: 'superseded'
                  }
                ]
              }
            }
          ],
          assistantResponse: `Found it. Version v3.2.1 was deployed 45 minutes ago, which aligns with when the connection pool issues started. The deployment included an ORM update to v5.2.0 and new async batch processing. The ORM update likely introduced a connection leak where connections aren't being properly released after queries complete. Recommend immediate rollback to v3.2.0.`,
          timestamp: timestamp + 240000,
          entities: [
            { type: 'service', value: service, extractedAt: timestamp + 240000, source: 'user_message' }
          ]
        }
      ];
    }
  },
  // Memory leak with gradual degradation
  {
    name: (service: string) => `Memory leak causing OOM restarts in ${service}`,
    turns: (service: string, timestamp: number): ConversationTurn[] => {
      const ticketId = generateTicketId();

      return [
        {
          userMessage: `${service} keeps restarting with OOM errors, is there a memory leak?`,
          toolResults: [
            {
              name: 'get_service_metrics',
              result: {
                service,
                memory_usage_mb: [680, 842, 1024, 1256, 1489, 1702, 1891, 2048],
                timestamps: Array.from({ length: 8 }, (_, i) =>
                  new Date(timestamp - (7 - i) * 3600000).toISOString()
                ),
                memory_limit_mb: 2048,
                restart_count_24h: 7,
                last_restart: new Date(timestamp - 1800000).toISOString(),
                restart_reason: 'OOMKilled'
              }
            }
          ],
          assistantResponse: `Yes, ${service} shows a clear memory leak pattern. Memory usage has grown linearly from 680MB to 2GB over the past 7 hours, hitting the 2GB limit and triggering OOM kills. The service has restarted 7 times in the last 24 hours, with the most recent restart 30 minutes ago. At the current growth rate (~200MB/hour), the next OOM will occur in approximately 45 minutes.`,
          timestamp,
          entities: [
            { type: 'service', value: service, extractedAt: timestamp, source: 'user_message' },
            { type: 'timestamp', value: new Date(timestamp - 1800000).toISOString(), extractedAt: timestamp, source: 'tool_result' }
          ]
        },
        {
          userMessage: 'What could be causing this? Any recent changes?',
          toolResults: [
            {
              name: 'get_deployment_history',
              result: {
                service,
                recent_deployments: [
                  {
                    version: 'v1.9.4',
                    deployed_at: new Date(timestamp - 36 * 3600000).toISOString(),
                    changes: ['Added WebSocket connection pooling', 'Implemented event stream caching']
                  }
                ]
              }
            },
            {
              name: 'query_logs',
              result: {
                service,
                warnings: [
                  { message: 'EventEmitter memory leak detected: 15 listeners added', count: 234 },
                  { message: 'WebSocket connection count: 1847 (high)', count: 89 }
                ]
              }
            }
          ],
          assistantResponse: `The memory leak started after v1.9.4 was deployed 36 hours ago, which added WebSocket connection pooling and event stream caching. The logs show EventEmitter memory leak warnings (15+ listeners) and an unusually high WebSocket connection count (1,847 connections). The issue is likely that WebSocket connections or event listeners aren't being properly cleaned up when clients disconnect, causing memory to accumulate.`,
          timestamp: timestamp + 90000,
          entities: [
            { type: 'service', value: service, extractedAt: timestamp + 90000, source: 'user_message' }
          ]
        },
        {
          userMessage: 'Create a ticket and recommend immediate action',
          toolResults: [
            {
              name: 'create_ticket',
              result: {
                ticket_id: ticketId,
                title: `URGENT: Memory leak in ${service} v1.9.4 WebSocket handling`,
                priority: 'critical',
                assigned_to: 'backend-team',
                description: 'Memory leak causing OOM restarts every ~2 hours. Root cause: WebSocket connections and EventEmitters not being cleaned up.'
              }
            }
          ],
          assistantResponse: `Created critical ticket ${ticketId} assigned to backend-team. Immediate recommendations:\n1. Rollback to v1.9.3 to stop the bleeding\n2. Add connection cleanup handlers for WebSocket disconnect events\n3. Implement proper EventEmitter cleanup (removeAllListeners on disconnect)\n4. Add memory profiling to staging before redeploying\n5. Consider adding connection limits and automatic cleanup for stale connections\n\nRollback should be executed within the next 30 minutes to prevent another OOM restart.`,
          timestamp: timestamp + 180000,
          entities: [
            { type: 'ticket', value: ticketId, extractedAt: timestamp + 180000, source: 'tool_result' },
            { type: 'service', value: service, extractedAt: timestamp + 180000, source: 'assistant_response' }
          ]
        }
      ];
    }
  },
  // Cache invalidation causing database overload
  {
    name: (service: string) => `Cache invalidation storm overwhelming ${service}`,
    turns: (service: string, timestamp: number): ConversationTurn[] => {
      const incidentTime = new Date(timestamp);

      return [
        {
          userMessage: `${service} database is getting hammered, what's causing the load spike?`,
          toolResults: [
            {
              name: 'get_service_metrics',
              result: {
                service,
                cache_hit_rate: 12.4,
                normal_cache_hit_rate: 96.8,
                db_query_rate: 8940,
                normal_db_query_rate: 340,
                db_cpu_usage: 94.2,
                cache_eviction_rate: 'critical'
              }
            },
            {
              name: 'query_logs',
              result: {
                service,
                log_patterns: [
                  { message: 'Cache miss for key: user_profile_*', count: 4523 },
                  { message: 'Cache miss for key: session_*', count: 3201 },
                  { message: 'Database query timeout (>5s)', count: 234 }
                ]
              }
            }
          ],
          assistantResponse: `${service} is experiencing a cache invalidation storm. Cache hit rate has collapsed from 96.8% to 12.4%, causing database query rate to spike from 340 to 8,940 queries/sec (26x increase). Database CPU is at 94% and queries are timing out. The cache misses are primarily for user_profile_* and session_* keys, suggesting a mass cache invalidation event occurred.`,
          timestamp,
          entities: [
            { type: 'service', value: service, extractedAt: timestamp, source: 'user_message' },
            { type: 'timestamp', value: incidentTime.toISOString(), extractedAt: timestamp, source: 'tool_result' }
          ]
        },
        {
          userMessage: 'When did this start and what triggered it?',
          toolResults: [
            {
              name: 'get_incident_timeline',
              result: {
                service,
                events: [
                  {
                    timestamp: new Date(timestamp - 25 * 60 * 1000).toISOString(),
                    event: 'cache_flush',
                    description: 'Redis FLUSHALL command executed',
                    source: 'deployment-script',
                    user: 'deploy-bot'
                  },
                  {
                    timestamp: new Date(timestamp - 23 * 60 * 1000).toISOString(),
                    event: 'alert',
                    description: 'Database CPU >90%',
                    severity: 'critical'
                  }
                ]
              }
            }
          ],
          assistantResponse: `The issue started 25 minutes ago when a Redis FLUSHALL command was executed by the deployment script (deploy-bot), wiping the entire cache. This forced all requests to hit the database directly, overwhelming it. The database CPU alert fired 2 minutes later. This appears to be an overly aggressive cache clearing strategy in the deployment process.`,
          timestamp: timestamp + 120000,
          entities: [
            { type: 'timestamp', value: new Date(timestamp - 25 * 60 * 1000).toISOString(), extractedAt: timestamp + 120000, source: 'tool_result' }
          ]
        },
        {
          userMessage: 'How do we recover and prevent this?',
          toolResults: [
            {
              name: 'get_service_status',
              result: {
                service,
                cache_hit_rate: 78.3,
                db_query_rate: 1240,
                db_cpu_usage: 62.1,
                cache_warming_progress: '78%'
              }
            }
          ],
          assistantResponse: `The cache is gradually warming up (78% complete). Cache hit rate has recovered to 78.3%, database query rate is down to 1,240/sec, and DB CPU is at 62%. The system should fully recover in about 10-15 minutes as the cache continues to warm.\n\nTo prevent this:\n1. Remove FLUSHALL from deployment scripts - use targeted cache invalidation instead\n2. Implement gradual cache warming during deployments\n3. Add cache warming endpoints that can be called pre-deployment\n4. Set up circuit breakers to protect the database from cache miss storms\n5. Add rate limiting on database queries during cache failures`,
          timestamp: timestamp + 300000,
          entities: [
            { type: 'service', value: service, extractedAt: timestamp + 300000, source: 'user_message' }
          ]
        }
      ];
    }
  },
  // Cascading failure from dependency
  {
    name: (service: string) => `Cascading failure: ${service} impacted by downstream service`,
    turns: (service: string, timestamp: number): ConversationTurn[] => {
      const incidentId = generateIncidentId();
      const downstreamService = generateServiceName();
      const incidentTime = new Date(timestamp);

      return [
        {
          userMessage: `${service} error rate is spiking, what's the root cause?`,
          toolResults: [
            {
              name: 'get_service_metrics',
              result: {
                service,
                error_rate: 23.7,
                latency_p95: 8200,
                latency_p99: 15400,
                timeout_rate: 18.4,
                circuit_breaker_status: 'half_open'
              }
            },
            {
              name: 'query_logs',
              result: {
                service,
                error_patterns: [
                  { error: `Timeout calling ${downstreamService}`, count: 1847, percentage: 67.2 },
                  { error: 'Circuit breaker open', count: 623, percentage: 22.7 },
                  { error: 'Connection refused', count: 278, percentage: 10.1 }
                ]
              }
            }
          ],
          assistantResponse: `${service} is experiencing a 23.7% error rate with severe latency degradation (P95: 8.2s, P99: 15.4s). The root cause is downstream: 67% of errors are timeouts calling ${downstreamService}, with circuit breakers opening to protect ${service}. This is a cascading failure originating from ${downstreamService}.`,
          timestamp,
          entities: [
            { type: 'service', value: service, extractedAt: timestamp, source: 'user_message' },
            { type: 'service', value: downstreamService, extractedAt: timestamp, source: 'tool_result' },
            { type: 'timestamp', value: incidentTime.toISOString(), extractedAt: timestamp, source: 'tool_result' }
          ]
        },
        {
          userMessage: `What's wrong with ${downstreamService}?`,
          toolResults: [
            {
              name: 'get_service_status',
              result: {
                service: downstreamService,
                status: 'degraded',
                health_score: 0.34,
                active_instances: 3,
                expected_instances: 12,
                cpu_usage: 98.7,
                error_rate: 45.2
              }
            },
            {
              name: 'get_incidents',
              result: {
                incidents: [{
                  id: incidentId,
                  title: `${downstreamService} instance failures causing service degradation`,
                  severity: 'CRITICAL',
                  status: 'investigating',
                  created_at: new Date(timestamp - 8 * 60 * 1000).toISOString(),
                  affected_services: [downstreamService, service, 'svc-checkout', 'api-cart']
                }]
              }
            }
          ],
          assistantResponse: `${downstreamService} is severely degraded with only 3 of 12 expected instances running. The remaining instances are at 98.7% CPU with a 45.2% error rate. Incident ${incidentId} was created 8 minutes ago (CRITICAL severity). The failure is cascading to multiple upstream services: ${service}, svc-checkout, and api-cart. This appears to be an infrastructure issue causing instance failures.`,
          timestamp: timestamp + 90000,
          entities: [
            { type: 'service', value: downstreamService, extractedAt: timestamp + 90000, source: 'user_message' },
            { type: 'incident', value: incidentId, extractedAt: timestamp + 90000, source: 'tool_result' }
          ]
        },
        {
          userMessage: 'What actions are being taken?',
          toolResults: [
            {
              name: 'get_incident_timeline',
              result: {
                incident_id: incidentId,
                events: [
                  {
                    timestamp: new Date(timestamp - 5 * 60 * 1000).toISOString(),
                    action: 'scale_up',
                    description: `Scaling ${downstreamService} from 3 to 15 instances`,
                    status: 'in_progress'
                  },
                  {
                    timestamp: new Date(timestamp - 3 * 60 * 1000).toISOString(),
                    action: 'investigation',
                    description: 'Root cause: AWS EC2 instance failures in us-east-1a AZ',
                    status: 'identified'
                  }
                ]
              }
            }
          ],
          assistantResponse: `Active mitigation in progress:\n1. Scaling ${downstreamService} from 3 to 15 instances (started 5 minutes ago)\n2. Root cause identified: AWS EC2 instance failures in us-east-1a availability zone\n\nThe team is scaling up instances in healthy AZs to compensate. As new ${downstreamService} instances come online, ${service} should see error rates decrease and circuit breakers close. Expected recovery time: 5-10 minutes for full instance scale-up.`,
          timestamp: timestamp + 240000,
          entities: [
            { type: 'incident', value: incidentId, extractedAt: timestamp + 240000, source: 'tool_result' },
            { type: 'service', value: downstreamService, extractedAt: timestamp + 240000, source: 'assistant_response' },
            { type: 'service', value: service, extractedAt: timestamp + 240000, source: 'assistant_response' }
          ]
        }
      ];
    }
  },
  // Deployment rollback after error spike
  {
    name: (service: string) => `Post-deployment error spike requiring rollback in ${service}`,
    turns: (service: string, timestamp: number): ConversationTurn[] => {

      return [
        {
          userMessage: `${service} error rate jumped after the deployment, should we rollback?`,
          toolResults: [
            {
              name: 'get_service_metrics',
              result: {
                service,
                error_rate_current: 8.7,
                error_rate_pre_deploy: 0.3,
                deployment_time: new Date(timestamp - 12 * 60 * 1000).toISOString(),
                version_current: 'v4.1.0',
                version_previous: 'v4.0.9'
              }
            },
            {
              name: 'query_logs',
              result: {
                service,
                new_errors_post_deploy: [
                  { error: 'TypeError: Cannot read property \'id\' of undefined', count: 423, file: 'userController.js:142' },
                  { error: 'ValidationError: Required field \'email\' is missing', count: 287, file: 'validators/userSchema.js:56' }
                ],
                error_rate_per_min: 67
              }
            }
          ],
          assistantResponse: `Yes, ${service} v4.1.0 deployment 12 minutes ago has caused error rate to spike from 0.3% to 8.7% (29x increase). The new errors are:\n1. TypeError in userController.js:142 (423 occurrences) - null reference error\n2. ValidationError in userSchema.js:56 (287 occurrences) - missing required field\n\nThese are code defects introduced in v4.1.0. Immediate rollback to v4.0.9 is recommended.`,
          timestamp,
          entities: [
            { type: 'service', value: service, extractedAt: timestamp, source: 'user_message' },
            { type: 'timestamp', value: new Date(timestamp - 12 * 60 * 1000).toISOString(), extractedAt: timestamp, source: 'tool_result' }
          ]
        },
        {
          userMessage: 'Execute the rollback',
          toolResults: [
            {
              name: 'rollback_deployment',
              result: {
                service,
                from_version: 'v4.1.0',
                to_version: 'v4.0.9',
                status: 'in_progress',
                estimated_completion: new Date(timestamp + 3 * 60 * 1000).toISOString(),
                instances_rolled_back: 4,
                instances_remaining: 8
              }
            }
          ],
          assistantResponse: `Rollback initiated for ${service} from v4.1.0 to v4.0.9. Currently 4 of 12 instances have been rolled back. Estimated completion in 3 minutes. Monitoring error rates as rollback progresses.`,
          timestamp: timestamp + 60000,
          entities: [
            { type: 'service', value: service, extractedAt: timestamp + 60000, source: 'user_message' }
          ]
        },
        {
          userMessage: 'Check if error rate is improving',
          toolResults: [
            {
              name: 'get_service_metrics',
              result: {
                service,
                error_rate: 2.1,
                version_distribution: {
                  'v4.0.9': 12,
                  'v4.1.0': 0
                },
                rollback_status: 'completed'
              }
            }
          ],
          assistantResponse: `Rollback completed successfully. All 12 instances are now running v4.0.9. Error rate has dropped to 2.1% and is continuing to decline as the bad requests clear out. The service should return to normal 0.3% error rate within 5-10 minutes. The v4.1.0 deployment needs to be fixed and retested in staging before attempting production deployment again.`,
          timestamp: timestamp + 240000,
          entities: [
            { type: 'service', value: service, extractedAt: timestamp + 240000, source: 'user_message' }
          ]
        }
      ];
    }
  },
  // Traffic spike causing autoscaling
  {
    name: (service: string) => `Unexpected traffic spike triggering autoscale in ${service}`,
    turns: (service: string, timestamp: number): ConversationTurn[] => [
      {
        userMessage: `${service} is autoscaling rapidly, what's causing the traffic spike?`,
        toolResults: [
          {
            name: 'get_service_metrics',
            result: {
              service,
              request_rate_current: 12400,
              request_rate_normal: 1800,
              instance_count_current: 28,
              instance_count_normal: 8,
              cpu_usage_avg: 78.4,
              spike_start: new Date(timestamp - 18 * 60 * 1000).toISOString()
            }
          },
          {
            name: 'get_traffic_sources',
            result: {
              service,
              top_sources: [
                { source: 'mobile-app', requests_per_min: 8200, increase: '620%' },
                { source: 'web-app', requests_per_min: 2800, increase: '45%' },
                { source: 'partner-api', requests_per_min: 1400, increase: '12%' }
              ],
              top_endpoints: [
                { endpoint: '/api/v2/products/search', requests_per_min: 6700 },
                { endpoint: '/api/v2/products/details', requests_per_min: 3200 }
              ]
            }
          }
        ],
        assistantResponse: `${service} is experiencing a 6.9x traffic spike (12,400 req/min vs normal 1,800). The spike started 18 minutes ago and has triggered autoscaling from 8 to 28 instances. The traffic is primarily from mobile-app (620% increase) hitting product search and details endpoints. This appears to be a legitimate traffic surge, possibly from a marketing campaign or viral event. The autoscaling is working correctly to handle the load.`,
        timestamp,
        entities: [
          { type: 'service', value: service, extractedAt: timestamp, source: 'user_message' },
          { type: 'timestamp', value: new Date(timestamp - 18 * 60 * 1000).toISOString(), extractedAt: timestamp, source: 'tool_result' }
        ]
      },
      {
        userMessage: 'Is the service handling the load okay?',
        toolResults: [
          {
            name: 'get_service_health',
            result: {
              service,
              status: 'healthy',
              error_rate: 0.4,
              latency_p95: 240,
              latency_p99: 450,
              normal_latency_p95: 180,
              autoscale_headroom: '35%'
            }
          }
        ],
        assistantResponse: `Yes, ${service} is handling the traffic spike well. Error rate is stable at 0.4%, and latency is only slightly elevated (P95: 240ms vs normal 180ms). The autoscaler has 35% headroom before hitting max capacity. The service is healthy and scaling appropriately. No action needed unless traffic continues to grow beyond current autoscale limits.`,
        timestamp: timestamp + 90000,
        entities: [
          { type: 'service', value: service, extractedAt: timestamp + 90000, source: 'user_message' }
        ]
      }
    ]
  },
  // Database deadlock investigation
  {
    name: (service: string) => `Database deadlocks causing transaction failures in ${service}`,
    turns: (service: string, timestamp: number): ConversationTurn[] => {
      const ticketId = generateTicketId();

      return [
        {
          userMessage: `${service} is getting database deadlock errors, what's happening?`,
          toolResults: [
            {
              name: 'query_logs',
              result: {
                service,
                deadlock_count: 147,
                time_range: '30m',
                deadlock_errors: [
                  {
                    error: 'Deadlock found when trying to get lock; try restarting transaction',
                    count: 147,
                    tables_involved: ['orders', 'inventory', 'order_items']
                  }
                ]
              }
            },
            {
              name: 'get_database_metrics',
              result: {
                service,
                active_transactions: 234,
                long_running_transactions: 12,
                lock_wait_time_avg_ms: 1240,
                deadlock_rate_per_min: 4.9
              }
            }
          ],
          assistantResponse: `${service} is experiencing frequent database deadlocks (147 in the last 30 minutes, ~5 per minute). The deadlocks involve the orders, inventory, and order_items tables. There are 12 long-running transactions and average lock wait time is 1.24 seconds. This suggests a transaction ordering issue where different code paths are acquiring locks on these tables in different orders, leading to circular wait conditions.`,
          timestamp,
          entities: [
            { type: 'service', value: service, extractedAt: timestamp, source: 'user_message' }
          ]
        },
        {
          userMessage: 'What queries are involved in the deadlocks?',
          toolResults: [
            {
              name: 'analyze_deadlocks',
              result: {
                service,
                deadlock_patterns: [
                  {
                    transaction_1: 'UPDATE inventory SET quantity = quantity - ? WHERE product_id = ?',
                    transaction_2: 'UPDATE orders SET status = ? WHERE order_id = ?; UPDATE inventory...',
                    lock_sequence_conflict: 'T1 locks inventory then orders; T2 locks orders then inventory'
                  }
                ],
                affected_operations: ['checkout', 'order_cancellation', 'inventory_adjustment']
              }
            }
          ],
          assistantResponse: `Found the deadlock pattern: \n\nTransaction 1 (checkout): Locks inventory → then orders\nTransaction 2 (order updates): Locks orders → then inventory\n\nThis creates a circular wait condition. The affected operations are checkout, order cancellation, and inventory adjustments. To fix this, all transactions need to acquire locks in the same order (e.g., always lock orders before inventory, or vice versa).`,
          timestamp: timestamp + 120000,
          entities: [
            { type: 'service', value: service, extractedAt: timestamp + 120000, source: 'user_message' }
          ]
        },
        {
          userMessage: 'Create a ticket with the fix recommendation',
          toolResults: [
            {
              name: 'create_ticket',
              result: {
                ticket_id: ticketId,
                title: `Fix database deadlocks in ${service} by standardizing lock order`,
                priority: 'high',
                assigned_to: 'backend-team',
                description: 'Standardize transaction lock order: always acquire locks on orders table before inventory table'
              }
            }
          ],
          assistantResponse: `Created ticket ${ticketId} (high priority) for backend-team. Recommended fix:\n\n1. Refactor all transactions to acquire locks in consistent order: orders → inventory → order_items\n2. Add explicit lock ordering documentation to the codebase\n3. Consider using SELECT ... FOR UPDATE with NOWAIT to fail fast instead of waiting\n4. Add database deadlock monitoring and alerting\n\nShort-term mitigation: The application is already retrying deadlocked transactions, so this isn't causing user-facing errors, but it's degrading performance and should be fixed.`,
          timestamp: timestamp + 240000,
          entities: [
            { type: 'ticket', value: ticketId, extractedAt: timestamp + 240000, source: 'tool_result' },
            { type: 'service', value: service, extractedAt: timestamp + 240000, source: 'assistant_response' }
          ]
        }
      ];
    }
  }
];

async function seedDatabase() {
  console.log('🌱 Seeding OpsOrch Copilot database...\n');

  const store = new SqliteConversationStore(
    {
      maxConversations: 1000,
      maxTurnsPerConversation: 50,
      conversationTTLMs: 30 * 24 * 60 * 60 * 1000
    },
    DB_PATH
  );

  try {
    // Clear existing conversations
    console.log('🗑️  Clearing existing conversations...');
    await store.clear();

    const conversations: Conversation[] = [];

    // Generate conversations
    for (let i = 0; i < CONVERSATION_COUNT; i++) {
      const template = TEMPLATES[i % TEMPLATES.length];
      const service = generateServiceName();
      const createdAt = generateTimestamp(30);
      const chatId = randomUUID();

      const turns = template.turns(service, createdAt);
      const name = template.name(service);

      const conversation: Conversation = {
        chatId,
        name,
        turns,
        createdAt,
        lastAccessedAt: createdAt + Math.floor(Math.random() * 3600000) // 0-1 hour after creation
      };

      conversations.push(conversation);
      await store.set(chatId, conversation);

      console.log(`✅ Created: "${name}" (${turns.length} turns)`);
    }

    console.log(`\n✨ Successfully seeded ${CONVERSATION_COUNT} conversations!`);
    console.log(`📊 Statistics:`);
    console.log(`   - Total conversations: ${conversations.length}`);
    console.log(`   - Total turns: ${conversations.reduce((sum, c) => sum + c.turns.length, 0)}`);
    console.log(`   - Date range: ${new Date(Math.min(...conversations.map(c => c.createdAt))).toLocaleDateString()} - ${new Date(Math.max(...conversations.map(c => c.createdAt))).toLocaleDateString()}`);
    console.log(`   - Unique services: ${new Set(conversations.flatMap(c => c.turns.flatMap(t => t.entities?.filter(e => e.type === 'service').map(e => e.value) || []))).size}`);

    await store.close();
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

seedDatabase();

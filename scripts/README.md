# Database Seeding Scripts

## seedDatabase.ts

Populates the OpsOrch Copilot conversation database with realistic operational conversations for testing and demo purposes.

### Usage

```bash
npm run seed
```

### What It Does

The script generates 30 realistic operational conversations covering various incident scenarios:

1. **Auth/Latency Incidents** - Mobile login latency spikes with mitigation actions (rollback, Redis pool changes)
2. **Connection Pool Exhaustion** - Database connection pool issues with detailed investigation
3. **Memory Leaks** - OOM restarts with WebSocket/EventEmitter leak patterns
4. **Cache Invalidation Storms** - Mass cache flush causing database overload
5. **Cascading Failures** - Downstream service failures impacting upstream services
6. **Deployment Rollbacks** - Post-deployment error spikes requiring immediate rollback
7. **Traffic Spikes** - Unexpected traffic surges triggering autoscaling
8. **Database Deadlocks** - Transaction lock ordering issues causing deadlocks

### Conversation Quality

Each conversation includes:
- **Realistic timestamps** - Distributed over the last 30 days
- **Detailed metrics** - Latency percentiles, error rates, resource usage
- **Tool results** - Structured data from monitoring tools
- **Multi-turn investigations** - 2-3 turns showing problem → investigation → resolution
- **Incident IDs and tickets** - Proper tracking identifiers
- **Entity extraction** - Services, incidents, timestamps properly tagged
- **Contextual responses** - Responses reference specific data from tool results

### Example Output

```
There's a recent latency incident affecting the svc-identity for mobile logins in prod. 
P95 auth latency reached 1.1s around 2025-11-21 03:01 UTC, up from the normal 180ms baseline. 
The incident INC-12345 was created and is currently in 'investigating' status. 
Mitigation actions (rollback and Redis pool changes) have been applied. 
As of 2025-11-21 06:11 UTC, latency is reported as normalizing, with the incident still in 
'mitigating' status and health currently reported as ok.
```

### Configuration

- **Database Path**: `./data/conversations.db` (configurable via `DB_PATH` constant)
- **Conversation Count**: 30 (configurable via `CONVERSATION_COUNT` constant)
- **Date Range**: Last 30 days
- **Service Names**: Randomly generated with prefixes (svc-, api-, service-)

### Data Structure

Each conversation follows the `Conversation` type:
- `chatId`: UUID v4
- `name`: Descriptive title
- `turns`: Array of conversation turns with user messages, tool results, and assistant responses
- `createdAt`: Unix timestamp
- `lastAccessedAt`: Unix timestamp (0-1 hour after creation)
- `entities`: Extracted services, incidents, timestamps, tickets

### Notes

- The script clears existing conversations before seeding
- All data is synthetic and contains no real PII
- Conversations are searchable via the FTS index
- Service names, incident IDs, and metrics are randomly generated but realistic

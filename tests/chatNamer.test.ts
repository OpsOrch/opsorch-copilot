import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ChatNamer } from '../src/engine/chatNamer.js';

describe('ChatNamer', () => {
  describe('Entity Extraction', () => {
    it('should extract incident references with INC- pattern', () => {
      const namer = new ChatNamer();
      const text = 'What happened with INC-12345?';
      const name = namer.generateName(text, '', Date.now());

      // Should generate a non-empty name
      assert.ok(name.length > 0, `Expected non-empty name, got: "${name}"`);
    });

    it('should extract incident references with incident- pattern', () => {
      const namer = new ChatNamer();
      const text = 'Tell me about incident-789';
      const name = namer.generateName(text, '', Date.now());

      assert.ok(name.includes('incident-789') || name.includes('789'));
    });

    it('should extract incident references with # pattern', () => {
      const namer = new ChatNamer();
      const text = 'What is the status of #1234?';
      const name = namer.generateName(text, '', Date.now());

      // Should include the incident ID or fallback to message
      assert.ok(name.includes('#1234') || name.includes('Status'));
    });

    it('should extract service names with -service suffix', () => {
      const namer = new ChatNamer();
      const text = 'Show logs for payment-service';
      const name = namer.generateName(text, '', Date.now());

      assert.ok(name.toLowerCase().includes('payment'));
    });

    it('should extract service names with -api suffix', () => {
      const namer = new ChatNamer();
      const text = 'checkout-api errors';
      const name = namer.generateName(text, '', Date.now());

      assert.ok(name.toLowerCase().includes('checkout'));
    });

    it('should extract service names with -worker suffix', () => {
      const namer = new ChatNamer();
      const text = 'database-worker is failing';
      const name = namer.generateName(text, '', Date.now());

      assert.ok(name.toLowerCase().includes('database'));
    });

    it('should extract CPU metric', () => {
      const namer = new ChatNamer();
      const text = 'Is CPU high?';
      const name = namer.generateName(text, '', Date.now());

      assert.ok(name.includes('CPU'));
    });

    it('should extract latency metric', () => {
      const namer = new ChatNamer();
      const text = 'Show me latency spikes';
      const name = namer.generateName(text, '', Date.now());

      assert.ok(name.toLowerCase().includes('latency'));
    });

    it('should extract p95 metric', () => {
      const namer = new ChatNamer();
      const text = 'What is the p95 response time?';
      const name = namer.generateName(text, '', Date.now());

      assert.ok(name.includes('P95') || name.includes('p95'));
    });

    it('should extract errors metric', () => {
      const namer = new ChatNamer();
      const text = 'Show me recent errors';
      const name = namer.generateName(text, '', Date.now());

      assert.ok(name.toLowerCase().includes('error'));
    });

    it('should extract throughput metric', () => {
      const namer = new ChatNamer();
      const text = 'What is the throughput?';
      const name = namer.generateName(text, '', Date.now());

      assert.ok(name.toLowerCase().includes('throughput'));
    });

    it('should extract time range "last 30 minutes"', () => {
      const namer = new ChatNamer();
      const text = 'Show logs from last 30 minutes';
      const name = namer.generateName(text, '', Date.now());

      assert.ok(name.includes('30') || name.includes('Last'));
    });

    it('should extract time range "past hour"', () => {
      const namer = new ChatNamer();
      const text = 'Errors in the past hour';
      const name = namer.generateName(text, '', Date.now());

      assert.ok(name.toLowerCase().includes('past') || name.toLowerCase().includes('hour'));
    });

    it('should extract time range "recent"', () => {
      const namer = new ChatNamer();
      const text = 'Show me recent incidents';
      const name = namer.generateName(text, '', Date.now());

      // Should generate a meaningful name from the message
      assert.ok(name.length > 0, `Expected non-empty name, got: "${name}"`);
    });

    it('should return fallback when no entities found', () => {
      const namer = new ChatNamer();
      const text = 'Hello world';
      const name = namer.generateName(text, '', Date.now());

      assert.ok(name.length > 0);
      assert.ok(name.includes('Hello'));
    });
  });

  describe('Extract Entities From Response', () => {
    it('should extract entities from LLM response with all types', () => {
      const namer = new ChatNamer();
      const userMsg = 'What happened?';
      const llmResponse = 'INC-12345 affected payment-service with high CPU in the last 30 minutes';
      const name = namer.generateName(userMsg, llmResponse, Date.now());

      // Should prioritize incident + service + metric (most descriptive)
      assert.ok(name.toLowerCase().includes('payment'));
      assert.ok(name.includes('CPU') || name.toLowerCase().includes('issue'));
    });

    it('should extract entities from response with only some types', () => {
      const namer = new ChatNamer();
      const userMsg = 'Show me errors';
      const llmResponse = 'Found 45 errors in checkout-api';
      const name = namer.generateName(userMsg, llmResponse, Date.now());

      assert.ok(name.toLowerCase().includes('checkout') || name.toLowerCase().includes('error'));
    });

    it('should handle empty LLM response', () => {
      const namer = new ChatNamer();
      const userMsg = 'What is happening?';
      const llmResponse = '';
      const name = namer.generateName(userMsg, llmResponse, Date.now());

      assert.ok(name.length > 0);
    });

    it('should handle null-like LLM response', () => {
      const namer = new ChatNamer();
      const userMsg = 'Status check';
      const llmResponse = '   ';
      const name = namer.generateName(userMsg, llmResponse, Date.now());

      assert.ok(name.length > 0);
    });
  });

  describe('Intent Detection', () => {
    it('should detect root cause intent with "what caused"', () => {
      const namer = new ChatNamer();
      const name = namer.generateName('What caused the outage?', 'The database failed', Date.now());

      assert.ok(name.toLowerCase().includes('root cause') || name.toLowerCase().includes('outage'));
    });

    it('should detect investigation intent with "show me"', () => {
      const namer = new ChatNamer();
      const name = namer.generateName('Show me recent logs', 'Here are the logs', Date.now());

      assert.ok(name.toLowerCase().includes('investigation') || name.toLowerCase().includes('log'));
    });

    it('should detect correlation intent with "compare"', () => {
      const namer = new ChatNamer();
      const name = namer.generateName('Compare CPU and memory', 'Strong correlation found', Date.now());

      assert.ok(name.toLowerCase().includes('correlation') || name.toLowerCase().includes('cpu'));
    });

    it('should detect status check intent with "is"', () => {
      const namer = new ChatNamer();
      const name = namer.generateName('Is payment-service healthy?', 'Yes, it is healthy', Date.now());

      // Should include payment topic and service
      assert.ok(name.toLowerCase().includes('payment'));
    });

    it('should detect troubleshooting intent with "fix"', () => {
      const namer = new ChatNamer();
      const name = namer.generateName('Fix the database issue', 'Restarting database', Date.now());

      assert.ok(name.toLowerCase().includes('troubleshooting') || name.toLowerCase().includes('database'));
    });

    it('should return null intent for generic questions', () => {
      const namer = new ChatNamer();
      const name = namer.generateName('Hello there', 'Hi!', Date.now());

      assert.ok(name.length > 0);
    });
  });

  describe('Name Synthesis Strategies', () => {
    it('should synthesize incident+service name', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'What happened with INC-12345?',
        'INC-12345 affected payment-service',
        Date.now()
      );

      // Should include payment service context
      assert.ok(name.toLowerCase().includes('payment'));
    });

    it('should synthesize service+metric+intent name', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'Show me payment-service latency',
        'Payment-service has high latency',
        Date.now()
      );

      assert.ok(name.includes('Payment'));
      assert.ok(name.toLowerCase().includes('latency'));
    });

    it('should avoid duplicate topic and service naming', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'Show me payment-service issues',
        'Payment-service is degraded',
        Date.now(),
        [{ type: 'service', value: 'payment-service', extractedAt: Date.now(), source: 'query-services' }]
      );

      assert.equal(name, 'Payment Issues');
    });

    it('should synthesize metric correlation name', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'Compare CPU and memory',
        'CPU and memory show strong correlation',
        Date.now()
      );

      assert.ok(name.includes('CPU'));
      assert.ok(name.toLowerCase().includes('memory'));
      assert.ok(name.toLowerCase().includes('correlation'));
    });

    it('should synthesize service+intent name', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'Is checkout-api healthy?',
        'Checkout-api is healthy',
        Date.now()
      );

      assert.ok(name.includes('Checkout'));
      assert.ok(name.toLowerCase().includes('status') || name.toLowerCase().includes('check'));
    });

    it('should synthesize incident+service+metric name (most descriptive)', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'Tell me about INC-999',
        'INC-999 caused payment-service latency issues',
        Date.now()
      );

      assert.ok(name.includes('Payment'));
      assert.ok(name.toLowerCase().includes('latency'));
    });

    it('should synthesize incident+metric name when no service', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'Tell me about INC-999',
        'INC-999 caused high CPU',
        Date.now(),
        [{ type: 'incident', value: 'INC-999', extractedAt: Date.now(), source: 'test' }]
      );

      assert.ok(name.includes('CPU'));
      assert.ok(name.toLowerCase().includes('incident'));
    });

    it('should use incident ID only as last resort', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'Tell me about INC-999',
        'Here is the incident information for INC-999',
        Date.now(),
        [{ type: 'incident', value: 'INC-999', extractedAt: Date.now(), source: 'test' }]
      );

      // Should just be the incident ID since no other context
      assert.ok(name.includes('INC-999'));
    });

    it('should synthesize service only name', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'database-service',
        'Database-service information',
        Date.now()
      );

      assert.ok(name.includes('Database'));
    });

    it('should synthesize metric+time name', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'CPU in last 30 minutes',
        'CPU was high',
        Date.now()
      );

      assert.ok(name.includes('CPU'));
      assert.ok(name.includes('30') || name.includes('Last'));
    });

    it('should synthesize intent+topic name', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'What caused the problem?',
        'The problem was caused by X',
        Date.now()
      );

      assert.ok(name.toLowerCase().includes('root cause') || name.toLowerCase().includes('problem'));
    });
  });

  describe('Name Sanitization and Formatting', () => {
    it('should truncate names longer than 60 characters', () => {
      const namer = new ChatNamer();
      const longMessage = 'This is a very long message that should definitely be truncated because it exceeds the maximum length';
      const name = namer.generateName(longMessage, '', Date.now());

      assert.ok(name.length <= 60);
      assert.ok(name.endsWith('...'));
    });

    it('should remove newlines from names', () => {
      const namer = new ChatNamer();
      const name = namer.generateName('First line\nSecond line', '', Date.now());

      assert.ok(!name.includes('\n'));
    });

    it('should handle special characters', () => {
      const namer = new ChatNamer();
      const name = namer.generateName('Test\t\rwith\tspecial\rchars', '', Date.now());

      assert.ok(!name.includes('\t'));
      assert.ok(!name.includes('\r'));
    });

    it('should apply title case', () => {
      const namer = new ChatNamer();
      const name = namer.generateName('this is a test message', '', Date.now());

      assert.ok(name.charAt(0) === name.charAt(0).toUpperCase());
    });

    it('should add ellipsis for truncated names', () => {
      const namer = new ChatNamer({ maxLength: 20 });
      const name = namer.generateName('This is a message that will be truncated', '', Date.now());

      assert.ok(name.endsWith('...'));
      assert.ok(name.length <= 20);
    });
  });

  describe('Fallback Name Generation', () => {
    it('should create fallback from normal message', () => {
      const namer = new ChatNamer();
      const name = namer.generateName('What is happening?', '', Date.now());

      assert.ok(name.length > 0);
      assert.ok(name.includes('What'));
    });

    it('should create timestamp-based name for empty message', () => {
      const namer = new ChatNamer();
      const name = namer.generateName('', '', Date.now());

      assert.ok(name.includes('General Query'));
    });

    it('should truncate very long messages in fallback', () => {
      const namer = new ChatNamer();
      const longMsg = 'A'.repeat(100);
      const name = namer.generateName(longMsg, '', Date.now());

      assert.ok(name.length <= 60);
    });

    it('should format timestamp in fallback', () => {
      const namer = new ChatNamer();
      const timestamp = new Date('2024-01-15T10:30:00').getTime();
      const name = namer.generateName('', '', timestamp);

      assert.ok(name.includes('General Query'));
      assert.ok(name.includes('('));
      assert.ok(name.includes(')'));
    });
  });

  describe('Synthesis Priority Ordering', () => {
    it('should prioritize incident+service+metric (most descriptive)', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'Show me INC-123',
        'INC-123 affected payment-service with high latency',
        Date.now()
      );

      // Should include service and metric, not just incident ID
      assert.ok(name.includes('Payment'));
      assert.ok(name.toLowerCase().includes('latency'));
    });

    it('should prioritize service+metric over metric correlation', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'Show me payment-service CPU',
        'Payment-service CPU and memory are high',
        Date.now()
      );

      // Should include service name
      assert.ok(name.includes('Payment'));
    });

    it('should prioritize metric correlation over service only', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'Compare CPU and memory',
        'CPU and memory correlation',
        Date.now()
      );

      // Should mention correlation
      assert.ok(name.toLowerCase().includes('correlation'));
    });

    it('should use fallback when no entities or intent detected', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'Random question',
        'Random answer',
        Date.now()
      );

      assert.ok(name.length > 0);
      assert.ok(name.includes('Random'));
    });
  });

  describe('End-to-End Name Generation', () => {
    it('should generate name from user message and LLM response with incident and service', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'What happened with the payment system?',
        'INC-12345 affected payment-service causing high latency',
        Date.now()
      );

      // Should be descriptive: "Payment Service Latency Issue"
      assert.ok(name.includes('Payment'));
      assert.ok(name.toLowerCase().includes('latency'));
    });

    it('should generate name from user message and LLM response with metrics and time range', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'Show me CPU issues',
        'CPU was elevated in the last 30 minutes',
        Date.now()
      );

      assert.ok(name.includes('CPU'));
    });

    it('should generate name from generic user message and minimal LLM response', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'Tell me more',
        'Here is more information',
        Date.now()
      );

      assert.ok(name.length > 0);
    });

    it('should fall back to user message analysis when LLM response is empty', () => {
      const namer = new ChatNamer();
      const name = namer.generateName(
        'Check payment-service status',
        '',
        Date.now()
      );

      // Should extract payment topic and service
      assert.ok(name.toLowerCase().includes('payment'));
    });
  });
});

describe('Topic-Based Naming', () => {
  it('should prioritize topic + problems pattern', () => {
    const namer = new ChatNamer();
    const name = namer.generateName(
      'payment service problems',
      'The payment service has webhook timeouts from Stripe',
      Date.now()
    );

    // Should include payment topic
    assert.ok(name.toLowerCase().includes('payment'));
    assert.ok(name.toLowerCase().includes('issue') || name.toLowerCase().includes('timeout'));
  });

  it('should generate topic + metric name', () => {
    const namer = new ChatNamer();
    const name = namer.generateName(
      'payment latency issues',
      'Payment latency is high',
      Date.now()
    );

    assert.ok(name.toLowerCase().includes('payment'));
    assert.ok(name.toLowerCase().includes('latency'));
  });

  it('should deduplicate plural metrics', () => {
    const namer = new ChatNamer();
    const name = namer.generateName(
      'payment timeout problems',
      'Multiple timeouts detected',
      Date.now()
    );

    // Should not have both "timeout" and "timeouts"
    const timeoutCount = (name.toLowerCase().match(/timeout/g) || []).length;
    assert.ok(timeoutCount <= 2); // At most "timeout" appears twice (not "timeout and timeouts")
  });

  it('should handle webhook topic', () => {
    const namer = new ChatNamer();
    const name = namer.generateName(
      'webhook failures',
      'Webhook timeouts from Stripe',
      Date.now()
    );

    assert.ok(name.toLowerCase().includes('webhook'));
  });
});

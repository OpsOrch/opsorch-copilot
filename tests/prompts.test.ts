import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    buildSystemPrompt,
    buildPlannerPrompt,
    buildJsonPlannerPrompt,
    buildRefinementPrompt,
    buildJsonRefinementPrompt,
    buildFinalAnswerPrompt,
    buildToolContext,
} from '../src/prompts.js';
import { Tool } from '../src/types.js';

test('prompts', async (t) => {
    await t.test('buildSystemPrompt returns non-empty string', () => {
        const prompt = buildSystemPrompt();
        assert.ok(prompt.length > 0);
        assert.ok(prompt.includes('OpsOrch Copilot'));
    });

    await t.test('buildPlannerPrompt includes system prompt and tool context', () => {
        const toolContext = 'Available tools: query-incidents';
        const prompt = buildPlannerPrompt(toolContext);
        assert.ok(prompt.includes('OpsOrch Copilot'));
        assert.ok(prompt.includes(toolContext));
        assert.ok(prompt.includes('Planning'));
    });

    await t.test('buildJsonPlannerPrompt includes tool list', () => {
        const toolList = 'query-incidents: Query incidents\nquery-logs: Query logs';
        const prompt = buildJsonPlannerPrompt(toolList);
        assert.ok(prompt.includes('JSON Planning Mode'));
        assert.ok(prompt.includes(toolList));
        assert.ok(prompt.includes('reasoning'));
        assert.ok(prompt.includes('toolCalls'));
    });

    await t.test('buildJsonPlannerPrompt handles empty tool list', () => {
        const prompt = buildJsonPlannerPrompt('');
        assert.ok(prompt.includes('No tools available'));
    });

    await t.test('buildRefinementPrompt includes result count', () => {
        const toolContext = 'Available tools: query-incidents';
        const prompt = buildRefinementPrompt(toolContext, 3);
        assert.ok(prompt.includes('3 tool call'));
        assert.ok(prompt.includes('Refinement'));
        assert.ok(prompt.includes(toolContext));
        assert.ok(prompt.includes('NEVER INVENT'));
    });

    await t.test('buildJsonRefinementPrompt includes result summary and shared rules', () => {
        const toolList = 'query-incidents\nquery-alerts';
        const resultSummary = 'query-incidents returned error';
        const prompt = buildJsonRefinementPrompt(toolList, resultSummary);
        assert.ok(prompt.includes('JSON Refinement Mode'));
        assert.ok(prompt.includes(resultSummary));
        assert.ok(prompt.includes('NEVER INVENT'));
        assert.ok(prompt.includes('reasoning'));
        assert.ok(prompt.includes('toolCalls'));
    });

    await t.test('buildFinalAnswerPrompt includes answer structure', () => {
        const prompt = buildFinalAnswerPrompt();
        assert.ok(prompt.includes('Answer Synthesis'));
        assert.ok(prompt.includes('conclusion'));
        assert.ok(prompt.includes('evidence'));
        assert.ok(prompt.includes('references'));
        assert.ok(prompt.includes('confidence'));
    });

    await t.test('buildToolContext formats tools correctly', () => {
        const tools: Tool[] = [
            { name: 'query-incidents', description: 'Query incidents' },
            { name: 'query-logs', description: 'Query logs' },
        ];
        const context = buildToolContext(tools);
        assert.ok(context.includes('Available MCP Tools'));
        assert.ok(context.includes('query-incidents: Query incidents'));
        assert.ok(context.includes('query-logs: Query logs'));
    });

    await t.test('buildToolContext handles empty tool list', () => {
        const context = buildToolContext([]);
        assert.strictEqual(context, 'No tools available.');
    });

    await t.test('buildToolContext handles tools without descriptions', () => {
        const tools: Tool[] = [
            { name: 'query-incidents' },
        ];
        const context = buildToolContext(tools);
        assert.ok(context.includes('query-incidents: no description'));
    });
});

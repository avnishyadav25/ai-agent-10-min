// Offline tests: no network, no API key. The Anthropic client is stubbed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Anthropic = require('@anthropic-ai/sdk');
const { createAgent, describeError, runTools, DEFAULT_MODEL } = require('../agent');

// A fake client that returns canned responses and records each request.
function fakeClient(responses) {
  const requests = [];
  return {
    requests,
    messages: {
      create: async (params) => {
        requests.push(structuredClone(params)); // snapshot: the agent mutates its history
        const next = responses.shift();
        if (!next) throw new Error('no more fake responses');
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

const text = (t, stop = 'end_turn') => ({ role: 'assistant', stop_reason: stop, content: [{ type: 'text', text: t }] });
const toolCall = (id, name, input = {}) => ({
  role: 'assistant',
  stop_reason: 'tool_use',
  content: [
    { type: 'thinking', thinking: '', signature: 'sig' }, // Opus 5.5 can return thinking blocks
    { type: 'tool_use', id, name, input },
  ],
});

test('tool call round trip: runs the tool and sends the result back', async () => {
  const client = fakeClient([toolCall('toolu_1', 'get_current_time'), text('It is noon.')]);
  const agent = createAgent({ client, impls: { get_current_time: () => 'The current time is 12:00:00.' } });

  assert.equal(await agent.chat("What's the time?"), 'It is noon.');
  assert.equal(client.requests.length, 2);

  const first = client.requests[0];
  assert.equal(first.model, DEFAULT_MODEL);
  assert.equal(first.tools[0].name, 'get_current_time');
  assert.ok(first.max_tokens > 0);

  const [, assistant, results] = client.requests[1].messages;
  assert.equal(assistant.role, 'assistant');
  assert.equal(assistant.content[0].type, 'thinking', 'full assistant content is kept, thinking included');
  assert.deepEqual(results, {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'The current time is 12:00:00.' }],
  });
});

test('parallel tool calls: all results in one user message', async () => {
  const both = {
    role: 'assistant',
    stop_reason: 'tool_use',
    content: [
      { type: 'tool_use', id: 'a', name: 'get_current_time', input: {} },
      { type: 'tool_use', id: 'b', name: 'get_current_time', input: {} },
    ],
  };
  const client = fakeClient([both, text('done')]);
  const agent = createAgent({ client, impls: { get_current_time: () => 'now' } });
  await agent.chat('time twice');
  const msgs = client.requests[1].messages;
  assert.equal(msgs.length, 3); // user, assistant (once), user with both results
  assert.deepEqual(msgs[2].content.map((r) => r.tool_use_id), ['a', 'b']);
});

test('unknown or failing tool returns is_error instead of crashing', async () => {
  const results = await runTools(
    [
      { type: 'tool_use', id: 'x', name: 'nope', input: {} },
      { type: 'tool_use', id: 'y', name: 'boom', input: {} },
    ],
    { boom: () => { throw new Error('kaput'); } },
  );
  assert.deepEqual(results.map((r) => [r.tool_use_id, r.is_error]), [['x', true], ['y', true]]);
  assert.match(results[0].content, /not found/);
  assert.match(results[1].content, /kaput/);
});

test('memory carries over between turns', async () => {
  const client = fakeClient([text('Nice to meet you, Avnish.'), text('Your name is Avnish.')]);
  const agent = createAgent({ client });
  await agent.chat('My name is Avnish.');
  await agent.chat('What is my name?');

  const second = client.requests[1].messages;
  assert.deepEqual(second.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(second[0].content, 'My name is Avnish.');
  assert.equal(second[1].content[0].text, 'Nice to meet you, Avnish.');
  assert.equal(agent.history.length, 4);
});

test('tool loop stops after the safety limit and leaves valid history', async () => {
  const calls = Array.from({ length: 6 }, (_, i) => toolCall(`t${i}`, 'get_current_time'));
  const client = fakeClient(calls);
  const agent = createAgent({ client, impls: { get_current_time: () => 'now' } });
  assert.match(await agent.chat('loop forever'), /too many tool calls/);
  const last = agent.history.at(-1);
  assert.equal(last.role, 'user');
  assert.equal(last.content[0].tool_use_id, 't5'); // every tool_use has a tool_result
});

test('refusal is reported and not kept in memory', async () => {
  const client = fakeClient([{ role: 'assistant', stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }]);
  const agent = createAgent({ client });
  assert.match(await agent.chat('something declined'), /declined.*cyber/);
  assert.equal(agent.history.length, 0);
});

test('API error: real SDK client with a stubbed fetch throws a typed error, memory is rolled back', async () => {
  const fetch = async () =>
    new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  const client = new Anthropic({ apiKey: 'test-key-not-real', fetch, maxRetries: 0 });
  const agent = createAgent({ client });

  await assert.rejects(agent.chat('hello'), (err) => {
    assert.ok(err instanceof Anthropic.AuthenticationError);
    assert.match(describeError(err), /ANTHROPIC_API_KEY/);
    return true;
  });
  assert.equal(agent.history.length, 0, 'failed turn is not left in memory');
});

test('real SDK client with a stubbed fetch: request body shape and a full turn', async () => {
  const bodies = [];
  const fetch = async (url, init) => {
    bodies.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: DEFAULT_MODEL,
        content: [{ type: 'text', text: 'Hello!' }],
        stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const agent = createAgent({ client: new Anthropic({ apiKey: 'test-key-not-real', fetch, maxRetries: 0 }) });
  assert.equal(await agent.chat('hi'), 'Hello!');
  assert.match(bodies[0].url, /\/v1\/messages$/);
  assert.equal(bodies[0].body.model, 'claude-opus-5-5');
  assert.deepEqual(bodies[0].body.messages, [{ role: 'user', content: 'hi' }]);
  assert.equal(bodies[0].body.tools[0].input_schema.type, 'object');
});

test('describeError covers rate limits and connection errors', () => {
  const rl = new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', new Headers());
  assert.match(describeError(rl), /429/);
  assert.match(describeError(new Anthropic.APIConnectionError({ message: 'offline' })), /reach the Anthropic API/);
});

import assert from 'node:assert';
import { createOpenAICompatibleCaller } from '../packages/sandbox-core/src/llm.ts';
import { runAgentLoop, type LLMMessage } from '../packages/sandbox-core/src/loop.ts';
import { resolveApiKey } from '../packages/sandbox-core/src/llm.ts';

async function main() {
  console.log('--- 1. Testing createOpenAICompatibleCaller streaming ---');
  const dsKey = resolveApiKey(undefined, 'deepseek');
  assert.ok(dsKey, 'DeepSeek API key should exist');

  const caller = createOpenAICompatibleCaller({
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-flash',
    apiKey: dsKey
  });

  const chunks: string[] = [];
  const res = await caller(
    [{ role: 'user', content: 'Count from 1 to 5 with spaces.' }],
    [],
    (delta) => chunks.push(delta)
  );

  console.log(`Streamed ${chunks.length} chunks. Full content: "${res.content}"`);
  assert.ok(chunks.length > 1, `Caller should produce multiple streaming chunks, got ${chunks.length}`);
  assert.strictEqual(chunks.join(''), res.content, 'Concatenated chunks should match final content');

  console.log('--- 2. Testing runAgentLoop SSE token-by-token emission ---');
  const loop = runAgentLoop(
    'You are a helpful assistant.',
    'Say "Hello World from MuseClaw" step by step',
    [],
    {},
    caller,
    { sessionId: 'test_sse_' + Date.now(), userId: 'test_user', botId: 'muse' }
  );

  const events: any[] = [];
  let deltaCount = 0;
  for await (const event of loop) {
    events.push(event);
    if (event.type === 'stream:text-delta') {
      deltaCount++;
      process.stdout.write(event.text);
    }
  }
  console.log(`\nAgent loop emitted ${deltaCount} text-delta events.`);
  assert.ok(deltaCount > 1, `Agent loop should yield multiple stream:text-delta events, got ${deltaCount}`);

  console.log('\n🎉 ALL SSE STREAMING TESTS PASSED 100%!');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

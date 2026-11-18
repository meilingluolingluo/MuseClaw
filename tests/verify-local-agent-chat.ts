import assert from 'node:assert';
import { createLocalAgentCaller } from '../packages/sandbox-core/src/local-agent-runner.ts';
import { globalModelStore } from '../apps/gateway/bots/provider-store.ts';

async function main() {
  console.log('--- 1. Testing Pi Local Agent Caller ---');
  const piCaller = createLocalAgentCaller({
    id: 'pi',
    name: 'Pi',
    baseUrl: 'local://pi',
    model: ''
  });
  const t0 = Date.now();
  const piRes = await piCaller([{ role: 'user', content: 'What is 3 + 4? Reply only the number.' }], []);
  console.log(`Pi response (${Date.now() - t0}ms):`, JSON.stringify(piRes));
  assert.ok(piRes.content && piRes.content.includes('7'), 'Pi should return 7');

  console.log('--- 2. Testing Codex Local Agent Caller ---');
  const codexCaller = createLocalAgentCaller({
    id: 'codex',
    name: 'Codex',
    baseUrl: 'local://codex',
    model: ''
  });
  const t1 = Date.now();
  const codexRes = await codexCaller([{ role: 'user', content: 'What is 10 + 20? Reply only the number.' }], []);
  console.log(`Codex response (${Date.now() - t1}ms):`, JSON.stringify(codexRes));
  assert.ok(codexRes.content && codexRes.content.includes('30'), 'Codex should return 30');

  console.log('--- ALL LOCAL AGENT CALLER TESTS PASSED ---');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

import assert from 'node:assert';
import { SessionStore } from '../apps/gateway/bots/session-store.ts';

async function main() {
  console.log('--- Testing SessionStore with toolCalls & reasoning persistence ---');

  const testStore = new SessionStore();
  const testUserId = 'test_tool_user';
  const testSessionId = `test_sess_${Date.now()}`;

  const session = testStore.create(testSessionId, 'ops_ninja', '测试工具持久化', testUserId);

  session.messages.push({
    role: 'user',
    content: '测试获取天气'
  });

  const mockToolCalls = [
    {
      tool: 'web_fetch',
      params: { url: 'https://wttr.in/?format=j1' },
      status: 'done',
      startedAt: Date.now() - 1119,
      durationMs: 1119,
      ok: true,
      result: { weather: 'Sunny' }
    },
    {
      tool: 'execute_shell',
      params: { command: 'curl -s https://ipinfo.io/json' },
      status: 'done',
      startedAt: Date.now() - 30,
      durationMs: 30,
      ok: true,
      result: { stdout: '{"ip": "1.2.3.4"}\n', exitCode: 0 }
    }
  ];

  session.messages.push({
    role: 'assistant',
    content: '已经为你查询到了天气和出口IP。',
    reasoning: '首先调用web_fetch获取天气，随后调用execute_shell获取出口IP...',
    toolCalls: mockToolCalls
  });

  testStore.save(session, testUserId);

  // Reload from store
  const loaded = testStore.get(testSessionId, testUserId);
  assert.ok(loaded, 'Session must exist after saving');
  assert.strictEqual(loaded.messages.length, 2, 'Must have 2 messages');

  const assistantMsg = loaded.messages[1] as any;
  assert.strictEqual(assistantMsg.role, 'assistant');
  assert.ok(assistantMsg.toolCalls, 'toolCalls must be preserved in loaded session');
  assert.strictEqual(assistantMsg.toolCalls.length, 2, 'Must have 2 tool calls');
  assert.strictEqual(assistantMsg.toolCalls[0].tool, 'web_fetch');
  assert.strictEqual(assistantMsg.toolCalls[0].durationMs, 1119);
  assert.strictEqual(assistantMsg.toolCalls[1].tool, 'execute_shell');
  assert.strictEqual(assistantMsg.toolCalls[1].durationMs, 30);
  assert.strictEqual(assistantMsg.reasoning, '首先调用web_fetch获取天气，随后调用execute_shell获取出口IP...');

  // Clean up test session
  testStore.delete(testSessionId, testUserId);
  console.log('🎉 ALL TOOL CALL PERSISTENCE TESTS PASSED 100%!');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

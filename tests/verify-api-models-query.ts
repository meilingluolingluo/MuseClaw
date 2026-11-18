import assert from 'node:assert';

async function main() {
  console.log('--- 1. Testing GET /api/models/config ---');
  const res = await fetch('http://localhost:8799/api/models/config');
  assert.strictEqual(res.status, 200, 'GET /api/models/config should return 200');
  const config = await res.json();

  const ds = config.providers.find((p: any) => p.id === 'deepseek');
  assert.ok(ds, 'DeepSeek provider should exist');
  console.log('DeepSeek models from API:', ds.candidateModels);
  assert.ok(Array.isArray(ds.candidateModels) && ds.candidateModels.length > 0, 'DeepSeek should have queried models');
  assert.ok(!ds.candidateModels.includes('gpt-4o'), 'DeepSeek should NOT contain unrelated or fake models');
  assert.strictEqual(ds.candidateModels.includes('deepseek-flash'), true, 'DeepSeek must include actual model deepseek-flash');

  const unconfigured = config.providers.find((p: any) => p.id === 'openai');
  assert.ok(unconfigured, 'OpenAI provider should exist');
  console.log('Unconfigured OpenAI candidateModels:', unconfigured.candidateModels);
  assert.strictEqual(unconfigured.candidateModels.length, 0, 'Unconfigured provider must NOT contain fake models');

  console.log('--- 2. Testing POST /api/models/fetch-models ---');
  const fetchRes = await fetch('http://localhost:8799/api/models/fetch-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId: 'deepseek' })
  });
  assert.strictEqual(fetchRes.status, 200);
  const fetchJson = await fetchRes.json();
  console.log('Fetch models result:', fetchJson);
  assert.strictEqual(fetchJson.ok, true);
  assert.ok(fetchJson.models.length >= 2);

  console.log('--- 3. Testing POST /api/models/test connection with models returned ---');
  const testRes = await fetch('http://localhost:8799/api/models/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'deepseek',
      baseUrl: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-flash'
    })
  });
  const testJson = await testRes.json();
  console.log('Test connection result:', testJson);
  assert.strictEqual(testJson.ok, true);
  assert.ok(testJson.models && testJson.models.length > 0, 'Test connection should return live models from API');

  console.log('🎉 ALL API MODEL QUERYING TESTS PASSED 100%!');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

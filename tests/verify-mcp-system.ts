import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpClientManager } from '../apps/gateway/mcp/client.ts';
import { parseMcpPaste } from '../apps/gateway/mcp/parser.ts';
import { MASK_PLACEHOLDER } from '../apps/gateway/mcp/redact.ts';
import { ConnectorManager } from '../apps/gateway/src/connectors.ts';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.resolve(__dirname, './.tmp_test_mcp_system');
const mockServerPath = path.resolve(__dirname, './mock-mcp-server.mjs');

if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true, force: true });
}
fs.mkdirSync(testDir, { recursive: true });

function listenServer(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      resolve(addr.port);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function run() {
  console.log('🧪 开始全面测试升级后的 MCP 子系统...\n');

  // 1. 测试 Paste-Anything 智能解析器
  console.log('1. 测试 Paste-Anything 智能解析器...');
  {
    const jsonRes = parseMcpPaste(
      JSON.stringify({
        mcpServers: {
          github: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: '<YOUR_TOKEN>' }
          }
        }
      })
    );
    assert.strictEqual(jsonRes.ok, true);
    if (jsonRes.ok) {
      assert.strictEqual(jsonRes.entries.length, 1);
      assert.strictEqual(jsonRes.entries[0].name, 'github');
      assert.strictEqual(jsonRes.entries[0].gaps.length, 1);
      assert.strictEqual(jsonRes.entries[0].gaps[0].key, 'GITHUB_PERSONAL_ACCESS_TOKEN');
    }

    const vscodeRes = parseMcpPaste(
      JSON.stringify({
        servers: {
          linear: { type: 'http', url: 'https://mcp.linear.app/mcp' }
        }
      })
    );
    assert.strictEqual(vscodeRes.ok, true);
    if (vscodeRes.ok) {
      assert.strictEqual(vscodeRes.entries[0].config.transport, 'http');
    }

    const cliRes = parseMcpPaste(
      'claude mcp add my-sentry --transport http -H "Authorization: Bearer $SENTRY_TOKEN" https://mcp.sentry.dev/mcp'
    );
    assert.strictEqual(cliRes.ok, true);
    if (cliRes.ok) {
      assert.strictEqual(cliRes.entries[0].name, 'my-sentry');
      assert.strictEqual(cliRes.entries[0].config.transport, 'http');
      assert.strictEqual(cliRes.entries[0].gaps.length, 1);
    }

    const dockerRes = parseMcpPaste('docker run -i --rm -e API_KEY=secret123456 mcp/sqlite');
    assert.strictEqual(dockerRes.ok, true);
    if (dockerRes.ok) {
      assert.strictEqual(dockerRes.entries[0].config.command, 'docker');
      assert.strictEqual(dockerRes.entries[0].config.env?.API_KEY, 'secret123456');
      assert(dockerRes.entries[0].config.args?.includes('API_KEY'));
      assert(!dockerRes.entries[0].config.args?.includes('secret123456'));
    }

    const urlRes = parseMcpPaste('https://mcp.deepwiki.com/mcp');
    assert.strictEqual(urlRes.ok, true);
    if (urlRes.ok) {
      assert.strictEqual(urlRes.entries[0].name, 'deepwiki');
      assert.strictEqual(urlRes.entries[0].config.transport, 'http');
    }
  }
  console.log('  ✅ Paste-Anything 解析全格式通过\n');

  // 2. 测试 Stdio MCP 生命周期、工具治理、敏感策略、脱敏与预算截断
  console.log('2. 测试 Stdio MCP 生命周期、脱敏、预算截断与 Sentinel 联动...');
  const mcpConfigPath = path.join(testDir, 'mcp_servers.json');
  const manager = new McpClientManager(mcpConfigPath);
  const sentinel = new SentinelPolicyManager(path.join(testDir, 'grants.json'));

  try {
    const secretVal = 'super_secret_token_987654';
    const snap = await manager.upsertServer('calc', {
      transport: 'stdio',
      command: 'node',
      args: [mockServerPath],
      env: { CALC_SECRET: secretVal },
      maxResultBytes: 64
    });

    assert.strictEqual(snap.status, 'connected');
    assert.strictEqual(snap.toolCount, 1);
    assert.strictEqual(snap.envMasked.CALC_SECRET, MASK_PLACEHOLDER);
    assert(!JSON.stringify(snap).includes(secretVal), '快照中绝对禁止包含明文密钥');

    const exported = manager.exportMcpJson();
    assert(!exported.includes(secretVal), '导出的 mcp.json 必须脱敏');
    assert(exported.includes(MASK_PLACEHOLDER));

    // 通过 applyMcpJson 更新时保留掩码占位符，原密钥不得丢失
    await manager.applyMcpJson(exported);
    const afterJson = manager.getServerSnapshot('calc')!;
    assert.strictEqual(afterJson.envMasked.CALC_SECRET, MASK_PLACEHOLDER);

    // 试运行调用工具
    const callRes = await manager.callServerTool('calc', 'calculate_sum', { a: 100, b: 250 });
    assert.strictEqual(callRes.ok, true);
    assert(callRes.outputText.includes('350'));

    // 标记工具为敏感并检查 Sentinel 联动
    manager.setToolPolicy('calc', 'calculate_sum', { risk: 'sensitive' });
    sentinel.setDynamicAlwaysAskTools(manager.getSensitiveToolNames());
    const evalRes = sentinel.evaluateToolCall('mcp_calc_calculate_sum', { a: 1, b: 2 }, { approval_level: 'full' });
    assert.strictEqual(evalRes.isDangerous, true, '标记为 sensitive 的 MCP 工具即使 full 模式也应触发人工确认');

    // 禁用工具后不再暴露给 Agent
    manager.toggleTool('calc', 'calculate_sum', false);
    assert.strictEqual(manager.getToolDefinitions().length, 0);
    manager.toggleTool('calc', 'calculate_sum', true);
    assert.strictEqual(manager.getToolDefinitions().length, 1);

    // 停用状态下仍可删除
    await manager.setServerEnabled('calc', false);
    assert.strictEqual(manager.getServerSnapshot('calc')?.status, 'disabled');
    const removed = await manager.removeServer('calc');
    assert.strictEqual(removed, true);
    assert.strictEqual(manager.getServerSnapshot('calc'), null);
    console.log('  ✅ Stdio 生命周期、脱敏保留、Sentinel 联动与停用删除验证通过\n');

    // 3. 测试 Streamable HTTP MCP 服务端 (含 401 鉴权失败 + SSE 响应 + 正常调用)
    console.log('3. 测试 Streamable HTTP MCP 传输与鉴权探测...');
    const httpServer = http.createServer(async (req, res) => {
      if (req.url === '/auth-mcp') {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer' });
        return res.end('Unauthorized');
      }
      if (req.url === '/mcp' && req.method === 'POST') {
        let body = '';
        for await (const c of req) body += c;
        const msg = JSON.parse(body || '{}');
        if (msg.method === 'initialize') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'mcp-session-id': 'sess_http_1'
          });
          return res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                protocolVersion: '2025-03-26',
                serverInfo: { name: 'test-http-mcp', version: '1.0.0' },
                capabilities: { tools: {} }
              }
            })
          );
        }
        if (msg.method === 'notifications/initialized') {
          res.writeHead(202);
          return res.end();
        }
        if (msg.method === 'tools/list') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(
            `event: message\ndata: ${JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                tools: [
                  {
                    name: 'echo_http',
                    description: 'HTTP 测试回显',
                    inputSchema: { type: 'object', properties: { text: { type: 'string' } } }
                  }
                ]
              }
            })}\n\n`
          );
          return res.end();
        }
        if (msg.method === 'tools/call') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                content: [{ type: 'text', text: `HTTP_ECHO:${msg.params?.arguments?.text || ''}` }]
              }
            })
          );
        }
      }
      if (req.url === '/mcp' && req.method === 'DELETE') {
        res.writeHead(200);
        return res.end();
      }
      res.writeHead(404);
      res.end();
    });

    const httpPort = await listenServer(httpServer);
    try {
      const authProbe = await manager.probeServer({
        transport: 'http',
        url: `http://127.0.0.1:${httpPort}/auth-mcp`
      });
      assert.strictEqual(authProbe.ok, false);
      assert.strictEqual(authProbe.authRequired, true);
      assert.strictEqual(authProbe.errorKind, 'auth');

      const httpSnap = await manager.upsertServer('http_demo', {
        transport: 'http',
        url: `http://127.0.0.1:${httpPort}/mcp`,
        headers: { Authorization: 'Bearer secret_http_token_xyz' }
      });
      assert.strictEqual(httpSnap.status, 'connected');
      assert.strictEqual(httpSnap.toolCount, 1);
      assert.strictEqual(httpSnap.tools[0].name, 'echo_http');

      const httpCall = await manager.callServerTool('http_demo', 'echo_http', { text: 'hello' });
      assert.strictEqual(httpCall.ok, true);
      assert(httpCall.outputText.includes('HTTP_ECHO:hello'));

      // 测试 ConnectorManager 集成隔离性
      const connectors = new ConnectorManager(path.join(testDir, 'connectors.json'), manager);
      const customConn = await connectors.connect('http_conn_isolated', {
        label: 'Isolated HTTP MCP',
        transport: 'http',
        url: `http://127.0.0.1:${httpPort}/mcp`
      });
      assert.strictEqual(customConn.status, 'connected');
      assert.strictEqual(customConn.tools.length, 1);
      assert.strictEqual(customConn.tools[0].name, 'mcp_http_conn_isolated_echo_http');
      await connectors.remove('http_conn_isolated');
      await manager.removeServer('http_demo');
    } finally {
      await closeServer(httpServer);
    }
    console.log('  ✅ Streamable HTTP、401 诊断与 ConnectorManager 集成验证通过\n');

    // 4. 测试 Legacy SSE 自动回退连接
    console.log('4. 测试 Legacy SSE 传输与自动回退...');
    const sseClients = new Set<http.ServerResponse>();
    const sseServer = http.createServer(async (req, res) => {
      if (req.url === '/sse' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        });
        sseClients.add(res);
        res.write('event: endpoint\ndata: /messages\n\n');
        req.on('close', () => sseClients.delete(res));
        return;
      }
      if (req.url === '/messages' && req.method === 'POST') {
        let body = '';
        for await (const c of req) body += c;
        const msg = JSON.parse(body || '{}');
        res.writeHead(202);
        res.end();

        let result: any = {};
        if (msg.method === 'initialize') {
          result = {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'legacy-sse-mcp', version: '0.9.0' },
            capabilities: { tools: {} }
          };
        } else if (msg.method === 'tools/list') {
          result = {
            tools: [{ name: 'sse_ping', description: 'SSE Ping', inputSchema: { type: 'object', properties: {} } }]
          };
        } else if (msg.method === 'tools/call') {
          result = { content: [{ type: 'text', text: 'SSE_PONG' }] };
        } else {
          return;
        }
        const frame = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n\n`;
        for (const client of sseClients) client.write(frame);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const ssePort = await listenServer(sseServer);
    try {
      // 以 http 类型发起连接，遇到 GET/404 POST 时自动回退到 Legacy SSE
      const sseSnap = await manager.upsertServer('sse_demo', {
        transport: 'http',
        url: `http://127.0.0.1:${ssePort}/sse`
      });
      assert.strictEqual(sseSnap.status, 'connected');
      assert.strictEqual(sseSnap.transport, 'sse');
      assert.strictEqual(sseSnap.tools[0].name, 'sse_ping');
      const sseCall = await manager.callServerTool('sse_demo', 'sse_ping', {});
      assert.strictEqual(sseCall.ok, true);
      assert(sseCall.outputText.includes('SSE_PONG'));
      await manager.removeServer('sse_demo');
    } finally {
      for (const c of sseClients) c.end();
      await closeServer(sseServer);
    }
    console.log('  ✅ Legacy SSE 自动回退与工具执行验证通过\n');

    console.log('🎉 MCP 子系统全链路验证全部通过！');
  } finally {
    manager.stopAll();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
}

run().catch((err) => {
  console.error('❌ MCP 测试失败:', err);
  process.exit(1);
});

import readline from 'node:readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed);
    const { id, method, params } = req;

    if (method === 'initialize') {
      const resp = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock-calc-server', version: '1.0.0' }
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\n');
      return;
    }

    if (method === 'notifications/initialized') {
      return;
    }

    if (method === 'tools/list') {
      const resp = {
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'calculate_sum',
              description: '计算两个数字之和',
              inputSchema: {
                type: 'object',
                properties: {
                  a: { type: 'number', description: '第一个数' },
                  b: { type: 'number', description: '第二个数' }
                },
                required: ['a', 'b']
              }
            }
          ]
        }
      };
      process.stdout.write(JSON.stringify(resp) + '\n');
      return;
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params;
      if (name === 'calculate_sum') {
        const sum = Number(args.a) + Number(args.b);
        const resp = {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Sum is ${sum}` }]
          }
        };
        process.stdout.write(JSON.stringify(resp) + '\n');
        return;
      }
    }
  } catch (err) {
    // ignore
  }
});

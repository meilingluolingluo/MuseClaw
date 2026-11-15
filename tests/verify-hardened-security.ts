import assert from 'node:assert';
import { createDefaultTools } from '../packages/sandbox-core/src/tools.ts';
import { runAgentLoop, type LLMCaller } from '../packages/sandbox-core/src/loop.ts';
import { SentinelPolicyManager } from '../apps/sentinel/src/guard.ts';

console.log('🧪 开始测试 MuseClaw 架构加固项（环境变量脱敏 + Loop Guard 循环熔断 + Sentinel 云元数据防御）...\n');

// ==========================================
// 1. 测试凭证脱敏与环境变量剥离 (Credential Stripping)
// ==========================================
console.log('1. 测试 execute_shell 敏感环境变量剥离...');
process.env.DEEPSEEK_API_KEY = 'sk-super-secret-key-123456';
process.env.FEISHU_APP_SECRET = 'feishu-secret-abc-xyz';
process.env.INFOFLOW_ENCRYPT_KEY = 'infoflow-secret-789';

const tools = createDefaultTools();
const shellTool = tools.find(t => t.name === 'execute_shell')!;
assert(shellTool, '必须存在 execute_shell 工具');

const envRes = await shellTool.execute({ command: 'env' }) as { stdout: string };
assert(!envRes.stdout.includes('sk-super-secret-key-123456'), 'Shell 子进程绝不能读取到 DEEPSEEK_API_KEY');
assert(!envRes.stdout.includes('feishu-secret-abc-xyz'), 'Shell 子进程绝不能读取到 FEISHU_APP_SECRET');
assert(!envRes.stdout.includes('infoflow-secret-789'), 'Shell 子进程绝不能读取到 INFOFLOW_ENCRYPT_KEY');
assert(envRes.stdout.includes('MUSECLAW_SANDBOX=true'), '必须包含沙箱标记 MUSECLAW_SANDBOX');
console.log('  ✅ 敏感凭据已彻底从 Shell 执行子进程中剥离，沙箱标记验证通过\n');

// ==========================================
// 2. 测试 Sentinel Egress Gate 云元数据与私钥拦截
// ==========================================
console.log('2. 测试 Sentinel 出向防御 (169.254.169.254 云元数据与敏感凭证读取)...');
const sentinel = new SentinelPolicyManager();

// 2.1 探测云主机元数据 (AWS / GCP / 阿里云 / 腾讯云)
const checkMetadata = sentinel.evaluateToolCall('execute_shell', { command: 'curl -s http://169.254.169.254/latest/meta-data/' });
assert.strictEqual(checkMetadata.isDangerous, true, '探测 169.254.169.254 必须判定为高危');
assert(checkMetadata.reason?.includes('云主机元数据接口'));

// 2.2 浏览器访问元数据
const checkBrowser = sentinel.evaluateToolCall('browser_open', { url: 'http://169.254.169.254/api' });
assert.strictEqual(checkBrowser.isDangerous, true, '浏览器探测 169.254.169.254 必须判定为高危');

// 2.3 探测敏感系统文件与私钥
const checkShadow = sentinel.evaluateToolCall('execute_shell', { command: 'cat /etc/shadow' });
assert.strictEqual(checkShadow.isDangerous, true, '读取 /etc/shadow 必须判定为高危');

const checkRsa = sentinel.evaluateToolCall('execute_shell', { command: 'cat ~/.ssh/id_rsa' });
assert.strictEqual(checkRsa.isDangerous, true, '读取 id_rsa 私钥必须判定为高危');

// 2.4 普通只读命令正常放行
const checkNormal = sentinel.evaluateToolCall('execute_shell', { command: 'ls -la /tmp' });
assert.strictEqual(checkNormal.isDangerous, false, '普通只读命令不应拦截');
console.log('  ✅ 云元数据嗅探、系统私钥探测均被 Sentinel 物理拦截\n');

// ==========================================
// 3. 测试 Loop Guard 循环守卫与防停滞熔断
// ==========================================
console.log('3. 测试 Agent Loop 循环守卫 (重复动作熔断与连续相同报错熔断)...');

// 3.1 测试连续 3 次重复相同调用
let repeatStepCount = 0;
const repeatLLM: LLMCaller = async () => {
  repeatStepCount++;
  return {
    content: `思考步骤 ${repeatStepCount}`,
    toolCalls: [
      {
        id: `call_repeat_${repeatStepCount}`,
        name: 'execute_shell',
        args: { command: 'echo "hello identical"' }
      }
    ]
  };
};

let capturedRepeatGuardText = '';
const repeatLoop = runAgentLoop(
  'System',
  'Goal',
  tools,
  sentinel,
  repeatLLM,
  {
    sessionId: 'sess_guard_repeat',
    userId: 'user_1',
    botId: 'muse',
    maxSteps: 10
  }
);

for await (const event of repeatLoop) {
  if (event.type === 'stream:text-delta' && event.text.includes('Loop Guard')) {
    capturedRepeatGuardText = event.text;
  }
}

assert(capturedRepeatGuardText.includes('连续 3 次重复调用相同动作'), '必须捕获连续重复调用的熔断提示');
assert.strictEqual(repeatStepCount, 3, '在第 3 步重复时必须立刻熔断，不能继续执行到 step 10');
console.log('  ✅ 相同动作重复调用触发自动熔断，成功节省后续 Token');

// 3.2 测试连续 2 次相同报错停滞熔断
let errorStepCount = 0;
const errorLLM: LLMCaller = async () => {
  errorStepCount++;
  return {
    content: `尝试修复报错 ${errorStepCount}`,
    toolCalls: [
      {
        id: `call_err_${errorStepCount}`,
        name: 'execute_shell',
        args: { command: 'non_existent_command_xyz' }
      }
    ]
  };
};

let capturedErrorGuardText = '';
const errorLoop = runAgentLoop(
  'System',
  'Goal',
  tools,
  sentinel,
  errorLLM,
  {
    sessionId: 'sess_guard_error',
    userId: 'user_1',
    botId: 'muse',
    maxSteps: 10
  }
);

for await (const event of errorLoop) {
  if (event.type === 'stream:text-delta' && event.text.includes('Loop Guard')) {
    capturedErrorGuardText = event.text;
  }
}

assert(capturedErrorGuardText.includes('连续出现相同错误'), '必须捕获连续相同错误的停滞熔断提示');
assert.strictEqual(errorStepCount, 2, '在第 2 步出现重复相同报错时必须立刻熔断');
console.log('  ✅ 连续相同错误停滞触发自动熔断');

console.log('\n🎉 MuseClaw 架构加固项（凭证脱敏 + Loop Guard 熔断 + Sentinel 云元数据拦截）100% 验收通过！');

import { spawn } from 'node:child_process';
import { globalRunnerMesh } from '../packages/sandbox-core/src/index.ts';

async function main() {
  console.log('=== Step 1: 测试远程节点注册与心跳 ===');
  const reg = globalRunnerMesh.registerMachine({
    machineId: 'test-macbook-qijunhui',
    hostname: 'qijunhui-MacBook.local',
    platform: 'darwin',
    arch: 'arm64',
    ip: '10.24.55.102',
    runtimes: [
      {
        id: 'ducc',
        name: 'Baidu CC (本地 ducc)',
        version: '2.1.314.3',
        models: ['GLM-5.3-Flash-内部', 'Opus 4.8'],
        defaultModel: 'GLM-5.3-Flash-内部'
      },
      {
        id: 'ducx',
        name: 'Baidu CX (本地 ducx)',
        version: '10.168.0.1',
        models: ['gpt-5.6-sol', 'DeepSeek-V4.1-Flash'],
        defaultModel: 'gpt-5.6-sol'
      }
    ]
  });

  console.log('注册结果:', reg);
  const machines = globalRunnerMesh.listMachines();
  console.log('在线机器列表:', machines.map((m) => ({ id: m.id, host: m.hostname, status: m.status, runtimes: m.runtimes.length })));

  if (machines.length === 0 || machines[0].status !== 'online') {
    throw new Error('远程节点注册失败或未处于 online 状态');
  }

  console.log('\n=== Step 2: 验证云端自动发现远程 Agent 运行时 ===');
  const remoteAgents = globalRunnerMesh.getAggregatedRemoteAgents();
  console.log('远程 Agent 运行时:', remoteAgents.map((a) => ({ id: a.id, name: a.name, defaultModel: a.defaultModel })));
  if (!remoteAgents.some((a) => a.id === 'ducc') || !remoteAgents.some((a) => a.id === 'ducx')) {
    throw new Error('未能正确聚合远程节点上的 ducc/ducx 运行时');
  }

  console.log('\n=== Step 3: 测试端到端任务派发、长轮询提取、流式分块中继与完成 ===');
  // 模拟 Runner 端长轮询提取任务
  const runnerPollPromise = (async () => {
    const task = await globalRunnerMesh.pollTask('test-macbook-qijunhui', 5000);
    console.log('Runner 收到待执行任务:', { taskId: task?.taskId, agentId: task?.agentId, prompt: task?.prompt });
    if (!task) throw new Error('Runner 未能长轮询获取到任务');

    // 模拟本地 Agent 产生流式输出并回传给云端 Gateway
    globalRunnerMesh.streamTaskChunk(task.taskId, '你好，');
    await new Promise((r) => setTimeout(r, 50));
    globalRunnerMesh.streamTaskChunk(task.taskId, '我是运行在本地电脑上的 ducc！');
    await new Promise((r) => setTimeout(r, 50));

    // 提交任务完成
    globalRunnerMesh.completeTask(task.taskId, {
      ok: true,
      text: '你好，我是运行在本地电脑上的 ducc！',
      latencyMs: 120
    });
  })();

  // 云端 Gateway 派发任务给此计算节点，并监听流式分块
  const receivedChunks: string[] = [];
  const dispatchPromise = globalRunnerMesh.dispatchTask('ducc', '测试远程调用', {
    targetMachineId: 'test-macbook-qijunhui',
    onChunk: (chunk) => {
      console.log('云端 Gateway 收到远程 Runner 实时分块:', JSON.stringify(chunk));
      receivedChunks.push(chunk);
    }
  });

  const [_, runResult] = await Promise.all([runnerPollPromise, dispatchPromise]);
  console.log('云端 Gateway 收到最终执行结果:', runResult);

  if (!runResult.ok || !runResult.text.includes('ducc')) {
    throw new Error('远程任务执行或中继失败');
  }
  if (receivedChunks.length !== 2) {
    throw new Error(`流式分块接收数量异常 (期望 2，实际 ${receivedChunks.length})`);
  }

  console.log('\n=== Step 4: 测试 HTTP 真实接口连通性 ===');
  const res = await fetch('http://localhost:8799/api/runner/machines');
  const httpData = await res.json();
  console.log('/api/runner/machines HTTP 返回:', httpData);
  if (!httpData.ok) {
    throw new Error('HTTP 接口返回异常');
  }

  console.log('\n🎉 ALL CLOUD RUNNER MESH INTEGRATION VERIFICATIONS PASSED!');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

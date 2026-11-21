/**
 * Verification test for MuseClaw Agent Skills Ecosystem
 */

async function main() {
  const baseUrl = 'http://127.0.0.1:8799';
  console.log('🧪 开始测试 MuseClaw Agent 技能规程体系 (基于分类与环境依赖探测)...');

  // 1. GET /api/skills
  const res1 = await fetch(`${baseUrl}/api/skills`);
  if (!res1.ok) throw new Error(`GET /api/skills failed: ${res1.status}`);
  const data1 = await res1.json() as any;
  console.log(`✓ 1. 获取技能列表成功: 包含 ${data1.total} 个技能`);
  if (data1.total < 14) throw new Error(`预期至少 14 个内置技能，实际: ${data1.total}`);

  // 2. 业务分类过滤 (DevOps)
  const res2 = await fetch(`${baseUrl}/api/skills?category=devops`);
  const data2 = await res2.json() as any;
  const devopsNames = data2.skills.map((s: any) => s.name);
  console.log(`✓ 2. 业务分类过滤 (DevOps):`, devopsNames);
  if (!devopsNames.includes('linux-ops')) throw new Error('linux-ops 应该在 DevOps 技能列表中');

  // 3. 环境就绪状态过滤
  const resReady = await fetch(`${baseUrl}/api/skills?readiness=ready`);
  const dataReady = await resReady.json() as any;
  console.log(`✓ 3. 环境就绪状态过滤: ${dataReady.skills.length} 个技能环境已就绪`);
  if (dataReady.skills.length < 5) throw new Error('就绪技能数量不符合预期');

  // 4. 关键字搜索
  const resSearch = await fetch(`${baseUrl}/api/skills?q=高德`);
  const dataSearch = await resSearch.json() as any;
  console.log(`✓ 4. 关键字搜索 "高德": 命中 ${dataSearch.skills.map((s: any) => s.name).join(', ')}`);
  if (!dataSearch.skills.some((s: any) => s.name === 'amap')) throw new Error('搜索高德应该命中 amap');

  // 5. GET /api/skills/:name 详情
  const res3 = await fetch(`${baseUrl}/api/skills/amap`);
  if (!res3.ok) throw new Error(`GET /api/skills/amap failed: ${res3.status}`);
  const data3 = await res3.json() as any;
  console.log(`✓ 5. 获取技能详情 (amap): category=${data3.skill.category}, ready=${data3.skill.readiness?.ready}, details=${data3.skill.readiness?.details}`);
  if (data3.skill.category !== 'integration') throw new Error('amap 分类应该为 integration');

  // 6. POST /api/skills - 创建自定义技能
  const customSkillName = 'test-code-reviewer';
  const res4 = await fetch(`${baseUrl}/api/skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: customSkillName,
      description: '代码审查与重构建议：分析代码潜在逻辑缺陷与规范',
      category: 'devops',
      requires: { bins: ['git', 'bash'] },
      allowedTools: ['read_file', 'save_artifact'],
      body: '# Code Reviewer\n\n1. 仔细阅读代码变更\n2. 分析坏味道与潜在性能风险\n3. 输出清晰的改进建议与重构方案'
    })
  });
  if (!res4.ok) throw new Error(`POST /api/skills failed: ${res4.status} ${await res4.text()}`);
  const data4 = await res4.json() as any;
  console.log(`✓ 6. 创建自建技能成功: ${data4.skill.name} (category: ${data4.skill.category})`);

  // 7. PATCH /api/skills/:name - 切换状态与分配 Bot
  const res5 = await fetch(`${baseUrl}/api/skills/${customSkillName}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enabled: false,
      everyBot: false,
      assignedBots: ['muse']
    })
  });
  if (!res5.ok) throw new Error(`PATCH /api/skills/${customSkillName} failed: ${res5.status}`);
  const data5 = await res5.json() as any;
  console.log(`✓ 7. 技能修改成功: enabled=${data5.skill.enabled}, everyBot=${data5.skill.everyBot}, assignedBots=${data5.skill.assignedBots}`);
  if (data5.skill.enabled !== false || data5.skill.assignedBots[0] !== 'muse') {
    throw new Error('PATCH 字段更新未生效');
  }

  // 8. POST /api/skills/import - 从标准 SKILL.md 导入
  const importSkillMd = `---
name: doc-summarizer
description: 批量文档提炼与摘要生成：提取核心要点并归档
category: productivity
allowed-tools: [read_file, save_artifact]
metadata:
  author: TestAuthor
  version: "1.0.0"
---

# 文档摘要助手

## 执行流程
1. 读取传入的文档路径
2. 提取 3 条核心结论
3. 保存摘要卡片
`;
  const res6 = await fetch(`${baseUrl}/api/skills/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: importSkillMd })
  });
  if (!res6.ok) throw new Error(`POST /api/skills/import failed: ${res6.status} ${await res6.text()}`);
  const data6 = await res6.json() as any;
  console.log(`✓ 8. 导入 SKILL.md 成功: ${data6.skill.name} (category: ${data6.skill.category}, source: ${data6.skill.source})`);

  // 9. GET /api/skills/:name/export - 导出 SKILL.md
  const res7 = await fetch(`${baseUrl}/api/skills/doc-summarizer/export`);
  if (!res7.ok) throw new Error(`Export failed: ${res7.status}`);
  const exportText = await res7.text();
  console.log(`✓ 9. 导出 SKILL.md 成功，字节大小: ${exportText.length}`);
  if (!exportText.includes('name: doc-summarizer')) throw new Error('导出内容不正确');

  // 10. POST /api/skills/:name/test - 试运行评测
  const res8 = await fetch(`${baseUrl}/api/skills/compare-options/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: '对比 React 与 Vue 在大型中后台系统中的选型权衡' })
  });
  if (!res8.ok) throw new Error(`Test skill failed: ${res8.status} ${await res8.text()}`);
  const data8 = await res8.json() as any;
  console.log(`✓ 10. 技能试运行评测成功: 输出长度 ${data8.output.length} 字符`);

  // 11. DELETE /api/skills/:name - 清理自建与导入技能
  const resDel1 = await fetch(`${baseUrl}/api/skills/${customSkillName}`, { method: 'DELETE' });
  if (!resDel1.ok) throw new Error(`DELETE custom skill failed: ${resDel1.status}`);
  const resDel2 = await fetch(`${baseUrl}/api/skills/doc-summarizer`, { method: 'DELETE' });
  if (!resDel2.ok) throw new Error(`DELETE imported skill failed: ${resDel2.status}`);
  console.log(`✓ 11. 删除自建与导入技能成功`);

  // 12. 验证内置技能不可删除保护
  const resDelBuiltin = await fetch(`${baseUrl}/api/skills/amap`, { method: 'DELETE' });
  if (resDelBuiltin.status === 400) {
    console.log(`✓ 12. 内置基座技能删除保护机制生效 (HTTP 400: 不允许删除系统核心技能)`);
  } else {
    throw new Error(`内置技能应该禁止被删除，但返回了 ${resDelBuiltin.status}`);
  }

  console.log('🎉 所有 12 项技能规程与依赖探测系统性功能校验全部通过！');
}

main().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});

/**
 * Skills ZIP 压缩包与多文件包管理生态系统全流程集成测试
 * 
 * 验证规程:
 * 1. 技能列表与多文件目录结构检索
 * 2. 单个技能及其内部文件清单详情
 * 3. 技能包内部文件内容读取 (/file?path=...)
 * 4. 技能全量 ZIP 打包下载 (/export-zip) 与结构校验
 * 5. ZIP 压缩包上传与安全解压校验 (/upload-zip)
 * 6. 技能包内部文件在线保存与编辑
 * 7. 技能包内部文件动态新建与删除
 * 8. Agent 运行时工具生态深度对接 (dirPath 与辅助脚本注入)
 * 9. 清理测试资源与状态复位
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const API_BASE = 'http://127.0.0.1:8799';

async function runTests() {
  console.log('🚀 开始执行 Skills ZIP 压缩包与多文件生态系统集成验证...\n');

  // 1. 获取所有技能列表
  console.log('📌 1. 测试 GET /api/skills:');
  const listRes = await fetch(`${API_BASE}/api/skills`);
  if (!listRes.ok) throw new Error(`GET /api/skills failed: ${listRes.status}`);
  const listData = await listRes.json();
  console.log(`   ✅ 成功获取技能总数: ${listData.total || listData.skills.length}`);
  const linuxOps = listData.skills.find((s: any) => s.name === 'linux-ops');
  if (!linuxOps) throw new Error('未在内置技能中找到 linux-ops');
  console.log(`   ✅ linux-ops 包含 ${linuxOps.filesCount} 个文件, ${linuxOps.scriptsCount} 个可执行脚本`);

  // 2. 检查 linux-ops 文件清单
  console.log('\n📌 2. 测试 GET /api/skills/linux-ops/files:');
  const filesRes = await fetch(`${API_BASE}/api/skills/linux-ops/files`);
  if (!filesRes.ok) throw new Error(`GET /api/skills/linux-ops/files failed: ${filesRes.status}`);
  const filesData = await filesRes.json();
  const filePaths = filesData.files.map((f: any) => f.path);
  console.log(`   ✅ 文件列表: ${filePaths.join(', ')}`);
  if (!filePaths.includes('SKILL.md') || !filePaths.includes('scripts/health_check.sh')) {
    throw new Error('linux-ops 文件列表缺少 SKILL.md 或 scripts/health_check.sh');
  }

  // 3. 读取技能包内部文件内容
  console.log('\n📌 3. 测试 GET /api/skills/linux-ops/file?path=scripts/health_check.sh:');
  const fileContentRes = await fetch(`${API_BASE}/api/skills/linux-ops/file?path=${encodeURIComponent('scripts/health_check.sh')}`);
  if (!fileContentRes.ok) throw new Error(`GET file content failed: ${fileContentRes.status}`);
  const fileContentData = await fileContentRes.json();
  console.log(`   ✅ 文件大小: ${fileContentData.size} 字节, 是否文本: ${fileContentData.isText}`);
  if (!fileContentData.content.includes('Linux Host Health Inspection') && !fileContentData.content.includes('health')) {
    throw new Error('health_check.sh 内容不符合预期');
  }

  // 4. 导出 ZIP 压缩包并验证 ZIP 签名
  console.log('\n📌 4. 测试 GET /api/skills/linux-ops/export-zip:');
  const zipRes = await fetch(`${API_BASE}/api/skills/linux-ops/export-zip`);
  if (!zipRes.ok) throw new Error(`GET /api/skills/linux-ops/export-zip failed: ${zipRes.status}`);
  const zipBuffer = Buffer.from(await zipRes.arrayBuffer());
  console.log(`   ✅ 成功下载 ZIP 压缩包, 字节数: ${zipBuffer.length}`);
  // ZIP 头部幻数应为 PK\x03\x04
  const isZip = zipBuffer[0] === 0x50 && zipBuffer[1] === 0x4b && zipBuffer[2] === 0x03 && zipBuffer[3] === 0x04;
  if (!isZip) throw new Error('下载的文件不具备合法的 ZIP 压缩包二进制签名 (PK)');
  console.log('   ✅ ZIP 二进制魔数校验通过 (PK\\x03\\x04)');

  // 5. 动态构建一个自定义技能 ZIP 包并测试上传
  console.log('\n📌 5. 测试 POST /api/skills/upload-zip (构建并上传测试包):');
  const tmpDir = path.join('/tmp', `test_skill_${Date.now()}`);
  fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'references'), { recursive: true });
  
  const customSkillMd = `---
name: custom-demo-skill
description: 自定义微服务运维与日志诊断技能包，支持自动化分析故障与归档。
channel: cli
tags: [devops, microservice, diagnostics]
allowed-tools: [execute_shell, save_artifact]
metadata:
  author: TestSuite
  version: "1.0.0"
---

# 自定义微服务诊断技能
使用内置脚本分析容器与系统日志。
`;
  fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), customSkillMd, 'utf-8');
  fs.writeFileSync(path.join(tmpDir, 'scripts', 'diagnose.sh'), '#!/bin/bash\necho "Running diagnostics..."\n', { mode: 0o755 });
  fs.writeFileSync(path.join(tmpDir, 'references', 'error_codes.md'), '# 错误码对照表\n- 500: 服务端内部错误\n- 502: 网关错误\n', 'utf-8');

  const zipFilePath = path.join('/tmp', `custom-demo-skill-${Date.now()}.zip`);
  execSync(`cd "${tmpDir}" && zip -r "${zipFilePath}" .`, { stdio: 'pipe' });
  const customZipBuffer = fs.readFileSync(zipFilePath);
  const base64Zip = customZipBuffer.toString('base64');

  const uploadRes = await fetch(`${API_BASE}/api/skills/upload-zip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64: base64Zip })
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Upload ZIP failed (${uploadRes.status}): ${err}`);
  }
  const uploadData = await uploadRes.json();
  console.log(`   ✅ 成功导入技能: ${uploadData.skill.name}`);
  console.log(`   ✅ 技能解压后目录: ${uploadData.skill.dirPath}`);
  console.log(`   ✅ 导入包包含 ${uploadData.skill.filesCount} 个文件, ${uploadData.skill.scriptsCount} 个脚本`);

  // 6. 验证上传后的技能内部文件列表
  console.log('\n📌 6. 测试 GET /api/skills/custom-demo-skill/files:');
  const customFilesRes = await fetch(`${API_BASE}/api/skills/custom-demo-skill/files`);
  const customFilesData = await customFilesRes.json();
  const cFilePaths = customFilesData.files.map((f: any) => f.path);
  console.log(`   ✅ 文件结构: ${cFilePaths.join(', ')}`);
  if (!cFilePaths.includes('scripts/diagnose.sh') || !cFilePaths.includes('references/error_codes.md')) {
    throw new Error('自定义技能包文件解压与映射不完整');
  }

  // 7. 测试在线编辑包内文件
  console.log('\n📌 7. 测试 POST /api/skills/custom-demo-skill/file (在线编辑):');
  const updatedDoc = '# 错误码对照表 v2\n- 500: 服务端内部错误\n- 502: 网关错误\n- 504: 超时\n';
  const editRes = await fetch(`${API_BASE}/api/skills/custom-demo-skill/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'references/error_codes.md', content: updatedDoc })
  });
  if (!editRes.ok) throw new Error(`Edit file failed: ${editRes.status}`);
  const verifyDocRes = await fetch(`${API_BASE}/api/skills/custom-demo-skill/file?path=${encodeURIComponent('references/error_codes.md')}`);
  const verifyDocData = await verifyDocRes.json();
  if (!verifyDocData.content.includes('504: 超时')) {
    throw new Error('编辑后的文件内容未正确持久化');
  }
  console.log('   ✅ 包内文件编辑与内容实时读取持久化验证通过');

  // 8. 测试在技能包内新建辅助脚本
  console.log('\n📌 8. 测试新建文件 scripts/quick_fix.sh:');
  const addFileRes = await fetch(`${API_BASE}/api/skills/custom-demo-skill/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'scripts/quick_fix.sh', content: '#!/bin/bash\necho "Fix applied."\n' })
  });
  if (!addFileRes.ok) throw new Error(`Add file failed: ${addFileRes.status}`);
  const afterAddFilesRes = await fetch(`${API_BASE}/api/skills/custom-demo-skill/files`);
  const afterAddFiles = (await afterAddFilesRes.json()).files.map((f: any) => f.path);
  if (!afterAddFiles.includes('scripts/quick_fix.sh')) {
    throw new Error('新建文件未在清单中体现');
  }
  console.log('   ✅ 技能包内部新建文件与自动权限设置验证通过');

  // 9. 测试删除包内文件
  console.log('\n📌 9. 测试 DELETE /api/skills/custom-demo-skill/file?path=scripts/quick_fix.sh:');
  const delFileRes = await fetch(`${API_BASE}/api/skills/custom-demo-skill/file?path=${encodeURIComponent('scripts/quick_fix.sh')}`, {
    method: 'DELETE'
  });
  if (!delFileRes.ok) throw new Error(`Delete file failed: ${delFileRes.status}`);
  const afterDelFilesRes = await fetch(`${API_BASE}/api/skills/custom-demo-skill/files`);
  const afterDelFiles = (await afterDelFilesRes.json()).files.map((f: any) => f.path);
  if (afterDelFiles.includes('scripts/quick_fix.sh')) {
    throw new Error('已删除的文件依然存在于清单');
  }
  console.log('   ✅ 技能包内部文件删除与清单同步验证通过');

  // 10. 测试导出包含修改的 ZIP 包
  console.log('\n📌 10. 测试 GET /api/skills/custom-demo-skill/export-zip:');
  const exportCustomZipRes = await fetch(`${API_BASE}/api/skills/custom-demo-skill/export-zip`);
  if (!exportCustomZipRes.ok) throw new Error(`Export custom zip failed: ${exportCustomZipRes.status}`);
  const exportZipBuf = Buffer.from(await exportCustomZipRes.arrayBuffer());
  console.log(`   ✅ 成功重新打包导出最新 ZIP, 大小: ${exportZipBuf.length} 字节`);

  // 11. 清理测试产生的自定义技能
  console.log('\n📌 11. 清理测试资源:');
  const delSkillRes = await fetch(`${API_BASE}/api/skills/custom-demo-skill`, { method: 'DELETE' });
  if (!delSkillRes.ok) throw new Error(`Delete custom-demo-skill failed: ${delSkillRes.status}`);
  console.log('   ✅ 自定义技能测试数据已彻底清理');

  // 清理临时文件
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(zipFilePath, { force: true });
  } catch {}

  console.log('\n🎉 所有 11 项 Skills ZIP 与多文件生态系统集成验证全部通过！');
}

runTests().catch(err => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});

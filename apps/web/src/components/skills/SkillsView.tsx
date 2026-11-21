import React, { useState, useEffect } from 'react';
import { Layers, Box, Plug, RefreshCw } from 'lucide-react';
import { api } from '../../services/api';
import type { SandboxStatus, McpServer } from '../../types';

export const SkillsView: React.FC = () => {
  const [sandbox, setSandbox] = useState<SandboxStatus | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sb, mcp] = await Promise.all([
        api.getSandboxStatus(),
        api.getMcpServers(),
      ]);
      setSandbox(sb);
      setMcpServers(Array.isArray(mcp) ? mcp : []);
    } catch (err) {
      console.error('Failed to load sandbox/mcp info:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const ladderRungs = [
    { rung: 'Level 1: API', desc: '最低成本与开销，极速结构化交互', color: 'var(--accent-green)' },
    { rung: 'Level 2: CLI', desc: '受控 Linux 内核级微沙箱隔离执行', color: 'var(--om-accent)' },
    { rung: 'Level 3: Web', desc: '网页静态抓取与 API 语义解析', color: 'var(--accent-cyan)' },
    { rung: 'Level 4: Browser', desc: '无头浏览器自动化与 DOM 控制', color: 'var(--accent-amber)' },
    { rung: 'Level 5: GUI', desc: '屏幕像素识别与键鼠模拟（高成本）', color: 'var(--accent-red)' },
  ];

  return (
    <section className="view-stage">
      <div className="view-header">
        <div>
          <div className="view-heading">
            <Layers size={18} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px' }} />
            技能成本阶梯与微沙箱 (Ladder & MicroSandbox)
          </div>
          <div className="view-sub">API (最低成本) ⟶ CLI (Linux 微沙箱) ⟶ Web ⟶ Browser ⟶ GUI (屏幕投屏)。优先低开销接口，禁止跳级滥用</div>
        </div>
        <button type="button" className="btn-secondary" onClick={loadData} disabled={loading}>
          <RefreshCw size={14} /> 刷新状态
        </button>
      </div>

      {/* Bubblewrap Status */}
      <div style={{ background: 'var(--om-surface)', border: '1px solid var(--om-border)', borderRadius: '12px', padding: '18px', marginBottom: '20px' }}>
        <div style={{ fontWeight: 650, fontSize: '14px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Box size={16} /> Linux 内核级微沙箱状态 (Bubblewrap)
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-dim)', lineHeight: 1.6 }}>
          {sandbox?.available ? (
            <span style={{ color: 'var(--accent-green)' }}>
              ● 内核微沙箱就绪 · 引擎: {sandbox.engine || 'bubblewrap'} · 网络隔离与只读根挂载生效中
            </span>
          ) : (
            <span>● 正在使用标准受控子进程运行模式</span>
          )}
        </div>
      </div>

      {/* 5-Level Ladder */}
      <div style={{ fontWeight: 650, fontSize: '14px', marginBottom: '12px' }}>
        Channel Ladder 技能成本阶梯
      </div>
      <div className="ladder-grid">
        {ladderRungs.map((r, idx) => (
          <div
            key={idx}
            style={{
              background: 'var(--om-surface)',
              border: '1px solid var(--om-border)',
              borderRadius: '10px',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 650, color: r.color, marginBottom: '6px' }}>
              {r.rung}
            </div>
            <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', lineHeight: 1.4 }}>
              {r.desc}
            </div>
          </div>
        ))}
      </div>

      {/* MCP Servers */}
      <div style={{ background: 'var(--om-surface)', border: '1px solid var(--om-border)', borderRadius: '12px', padding: '18px' }}>
        <div style={{ fontWeight: 650, fontSize: '14px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plug size={16} /> Model Context Protocol (MCP) 工具生态
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            已挂载 {mcpServers.length} 个服务
          </span>
        </div>
        <div>
          {mcpServers.length === 0 ? (
            <div style={{ fontSize: '12.5px', color: 'var(--text-dim)' }}>暂无挂载的 MCP 服务器</div>
          ) : (
            mcpServers.map((s) => (
              <div key={s.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--om-border)', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px' }}>{s.name}</span>
                <span className="pill-badge pill-blue" style={{ fontSize: '11px' }}>{s.status}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
};

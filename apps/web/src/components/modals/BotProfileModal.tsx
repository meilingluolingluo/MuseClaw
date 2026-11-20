import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { BotAvatar } from '../common/BotAvatar';
import { List, Shield, Fingerprint, Sparkles, Terminal } from 'lucide-react';
import { api } from '../../services/api';

const AVATAR_PRESETS = [
  { id: 'haibara', name: '小哀 (Haibara)', desc: '沉静目光与浅蓝针织' },
  { id: 'moss-courier', name: '苔藓邮差 (Moss)', desc: '绿叶耳朵与布制信件包' },
  { id: 'tide-tinker', name: '潮汐工匠 (Tide)', desc: '海沫色蝾螈工匠与工具囊' },
  { id: 'dusk-moth', name: '暮光飞蛾 (Dusk)', desc: '圆眼镜与水彩双翼' },
  { id: 'copper-acorn', name: '纯铜橡果 (Copper)', desc: '纯铜齿轮与保暖围巾' },
];

export const BotProfileModal: React.FC = () => {
  const { isBotModalOpen, setIsBotModalOpen, activeBot, loadBots, showToast } = useApp();
  const [tab, setTab] = useState<'tasks' | 'security' | 'identity'>('identity');

  // Form states
  const [name, setName] = useState(activeBot?.name || '');
  const [role, setRole] = useState(activeBot?.role || '');
  const [systemPrompt, setSystemPrompt] = useState(activeBot?.systemPrompt || '');
  const [approvalMode, setApprovalMode] = useState(activeBot?.approvalMode || 'ASK');
  const [avatar, setAvatar] = useState(activeBot?.avatar || '🤖');
  const [saving, setSaving] = useState(false);

  // Sync state if activeBot changes
  React.useEffect(() => {
    if (activeBot) {
      setName(activeBot.name || '');
      setRole(activeBot.role || '');
      setSystemPrompt(activeBot.systemPrompt || '');
      setApprovalMode(activeBot.approvalMode || 'ASK');
      setAvatar(activeBot.avatar || '🤖');
    }
  }, [activeBot]);

  const handleSave = async () => {
    if (!activeBot) return;
    setSaving(true);
    try {
      await api.updateBot(activeBot.id, {
        name,
        role,
        systemPrompt,
        approvalMode: approvalMode as any,
        avatar,
      });
      showToast('数字员工配置已更新', 'success');
      loadBots();
      setIsBotModalOpen(false);
    } catch (err: any) {
      showToast(`保存失败: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isBotModalOpen}
      onClose={() => setIsBotModalOpen(false)}
      title={`数字员工: ${activeBot?.name || 'Bot'}`}
      icon={<BotAvatar bot={activeBot} size={24} still />}
      maxWidth="600px"
    >
      <div className="bot-profile-header" style={{ textAlign: 'center', marginBottom: '20px' }}>
        <div style={{ display: 'inline-block', marginBottom: '10px' }}>
          <BotAvatar bot={{ ...activeBot, avatar } as any} size={88} motion="avatar-idle" />
        </div>
        <div style={{ fontSize: '18px', fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: '12px', color: 'var(--accent-green)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
          <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-green)' }} />
          已连接就绪
        </div>

        <div className="bot-segmented-tabs" style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '16px' }}>
          <button
            type="button"
            className={`bot-segmented-tab ${tab === 'identity' ? 'active' : ''}`}
            onClick={() => setTab('identity')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '20px', border: '1px solid var(--om-border)', background: tab === 'identity' ? 'var(--om-accent)' : 'var(--om-surface)', color: tab === 'identity' ? '#fff' : 'var(--om-fg)', cursor: 'pointer' }}
          >
            <Fingerprint size={14} /> 身份与形象
          </button>
          <button
            type="button"
            className={`bot-segmented-tab ${tab === 'security' ? 'active' : ''}`}
            onClick={() => setTab('security')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '20px', border: '1px solid var(--om-border)', background: tab === 'security' ? 'var(--om-accent)' : 'var(--om-surface)', color: tab === 'security' ? '#fff' : 'var(--om-fg)', cursor: 'pointer' }}
          >
            <Shield size={14} /> 门禁审批
          </button>
          <button
            type="button"
            className={`bot-segmented-tab ${tab === 'tasks' ? 'active' : ''}`}
            onClick={() => setTab('tasks')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '20px', border: '1px solid var(--om-border)', background: tab === 'tasks' ? 'var(--om-accent)' : 'var(--om-surface)', color: tab === 'tasks' ? '#fff' : 'var(--om-fg)', cursor: 'pointer' }}
          >
            <List size={14} /> 常驻能力
          </button>
        </div>
      </div>

      <div className="bot-tab-body">
        {tab === 'identity' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12.5px', fontWeight: 650, display: 'block', marginBottom: '6px' }}>数字员工名称</label>
              <input
                type="text"
                className="form-control"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '12.5px', fontWeight: 650, display: 'block', marginBottom: '6px' }}>业务角色 / 职能描述</label>
              <input
                type="text"
                className="form-control"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12.5px', fontWeight: 650, display: 'block', marginBottom: '6px' }}>nanoMuse 形象预设</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px' }}>
                {AVATAR_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setAvatar(p.id)}
                    style={{
                      padding: '8px',
                      borderRadius: '8px',
                      border: avatar === p.id ? '2px solid var(--om-accent)' : '1px solid var(--om-border)',
                      background: 'var(--om-surface-2)',
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 600 }}>{p.name.split(' ')[0]}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '2px' }}>{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12.5px', fontWeight: 650, display: 'block', marginBottom: '6px' }}>系统人设提示词 (System Prompt)</label>
              <textarea
                className="form-control"
                rows={4}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '12px' }}
              />
            </div>
          </div>
        )}

        {tab === 'security' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12.5px', fontWeight: 650, display: 'block', marginBottom: '6px' }}>
                门禁审批级别 (Approval Mode)
              </label>
              <select
                className="form-control"
                value={approvalMode}
                onChange={(e) => setApprovalMode(e.target.value as any)}
                style={{ width: '100%' }}
              >
                <option value="ASK">ASK (严格模式: 高危动作全量拦截审批)</option>
                <option value="AUTO_EDITS">AUTO_EDITS (免批代码编辑与工件产出)</option>
                <option value="FULL">FULL (完全自驱模式: 仅拦截破坏底线)</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--om-surface-2)', borderRadius: '8px', border: '1px solid var(--om-border)' }}>
                <span style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Terminal size={14} /> 微沙箱环境隔离
                </span>
                <span className="pill-badge pill-blue" style={{ fontSize: '11px' }}>Bubblewrap 容器隔离</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--om-surface-2)', borderRadius: '8px', border: '1px solid var(--om-border)' }}>
                <span style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Shield size={14} /> 动态污点跟踪
                </span>
                <span className="pill-badge pill-green" style={{ fontSize: '11px' }}>纯净态 (Untainted)</span>
              </div>
            </div>
          </div>
        )}

        {tab === 'tasks' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', background: 'var(--om-surface-2)', borderRadius: '8px', border: '1px solid var(--om-border)' }}>
              <Sparkles size={18} style={{ color: 'var(--om-accent)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '13px' }}>Heartbeat 自驱常驻心跳</div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-dim)', marginTop: '2px' }}>
                  维持数字员工常驻心跳、例行任务巡检与目标 Check-in
                </div>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '24px' }}>
          <button type="button" className="btn-secondary" onClick={() => setIsBotModalOpen(false)}>
            取消
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存配置'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

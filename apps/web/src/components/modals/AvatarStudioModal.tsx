import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  RefreshCw,
  Check,
  X,
  Upload,
  Loader2,
  Play,
  RotateCcw,
  Settings,
  Trash2,
  Compass,
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { BotAvatar } from '../common/BotAvatar';
import type {
  Bot,
  AvatarMood,
  AvatarStyle,
  AvatarSession,
  AvatarPreset,
  AvatarStudioView,
  AvatarFaceMeta,
} from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

interface AvatarStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetBot?: Bot | null;
  onApplied?: (updatedBot: Bot) => void;
  zIndex?: number;
}

const STYLES_CATALOG: Array<{ id: AvatarStyle; label: string; desc: string; icon: string }> = [
  { id: 'muse', label: '3D 潮玩 (Muse)', desc: '收藏级搪胶玩具质感，圆润软萌，大眼摄影棚布光', icon: '🧸' },
  { id: 'flat', label: '扁平矢量 (Flat)', desc: '清爽柔和马卡龙色，极简几何轮廓与微阴影', icon: '🎨' },
  { id: 'clay', label: '粘土雕塑 (Clay)', desc: '温润哑光粘土手作质感，柔光摄影棚阴影', icon: '🏺' },
  { id: 'watercolor', label: '柔和水彩 (Watercolor)', desc: '轻盈水彩浸润，水彩纸纹肌理与柔和边缘', icon: '🖌️' },
  { id: 'pixel', label: '复古像素 (Pixel)', desc: '经典复古点阵像素，清晰剪影与限定调色板', icon: '👾' },
  { id: 'line', label: '极简线条 (Line)', desc: '米白基底双色极简描线，灵动自信线条', icon: '✍️' },
  { id: 'sticker', label: '立体贴纸 (Sticker)', desc: '高光反光质感，加粗白色边缘与鲜活高饱和', icon: '🏷️' },
];

const PROMPT_SUGGESTIONS = [
  '一只软萌治愈系小柴犬，系着红蓝格子围巾',
  '戴着巫师圆帽与发光小魔杖的学者猫咪',
  '圆滚滚的赛博朋克机械小猫，带有发光霓虹护目镜',
  '一只系着铃铛的可爱奶油水豚，头顶顶着一颗小橘子',
  '身穿航天服与小喷气背包的星际宇航员小兔子',
];

const MOODS_LIST: AvatarMood[] = ['idle', 'working', 'waiting', 'happy', 'error'];
const MOOD_NAMES: Record<AvatarMood, string> = {
  idle: '待机常态',
  working: '专注工作',
  waiting: '思考等待',
  happy: '喜悦完成',
  error: '纠错歉意',
};

export const AvatarStudioModal: React.FC<AvatarStudioModalProps> = ({
  isOpen,
  onClose,
  targetBot,
  onApplied,
  zIndex,
}) => {
  const { activeBot, showToast, loadBots, isImageModelModalOpen, setIsImageModelModalOpen } = useApp();
  const currentBot = targetBot || activeBot;

  const [activeTab, setActiveTab] = useState<'create' | 'presets'>('create');
  const [studioStatus, setStudioStatus] = useState<AvatarStudioView | null>(null);
  const [stageMood, setStageMood] = useState<AvatarMood>('idle');
  const [isAutoCycle, setIsAutoCycle] = useState(false);

  // 删除两步确认状态
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const deleteTimerRef = useRef<NodeJS.Timeout | null>(null);

  // AI 创作表单状态
  const [description, setDescription] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<AvatarStyle>('muse');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [session, setSession] = useState<AvatarSession | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // 轮询检查会话进度
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await api.avatarStatus(currentBot?.id);
      setStudioStatus(res);
      if (res.current && ['estimate', 'drawing', 'choose', 'posing'].includes(res.current.stage)) {
        setSession(res.current);
      }
    } catch (e: any) {
      console.warn('Failed to load avatar studio status:', e);
    }
  };

  useEffect(() => {
    if (!isImageModelModalOpen) {
      fetchStatus();
    }
  }, [isImageModelModalOpen]);

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      setConfirmDeleteId(null);
    }
  }, [isOpen, currentBot?.id]);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // 当会话处于 drawing 或 posing 阶段时，自动轮询刷新状态
  useEffect(() => {
    if (session && (session.stage === 'drawing' || session.stage === 'posing')) {
      if (!pollTimerRef.current) {
        pollTimerRef.current = setInterval(async () => {
          try {
            const res = await api.avatarStatus(currentBot?.id);
            if (res.current) {
              setSession(res.current);
              if (res.current.stage === 'choose' || res.current.stage === 'done' || res.current.stage === 'failed') {
                if (pollTimerRef.current) {
                  clearInterval(pollTimerRef.current);
                  pollTimerRef.current = null;
                }
              }
              if (res.current.stage === 'done') {
                setStudioStatus(res);
                loadBots();
              }
            }
          } catch {}
        }, 800);
      }
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [session?.stage, currentBot?.id]);

  // 情绪循环预览
  useEffect(() => {
    if (!isAutoCycle) return;
    const interval = setInterval(() => {
      setStageMood((prev) => {
        const nextIdx = (MOODS_LIST.indexOf(prev) + 1) % MOODS_LIST.length;
        return MOODS_LIST[nextIdx];
      });
    }, 2400);
    return () => clearInterval(interval);
  }, [isAutoCycle]);

  // 发起 AI 创作
  const handleBeginAndStart = async () => {
    if (!description.trim()) {
      showToast('请输入形象描述文本', 'warning');
      return;
    }
    setBusy('draw');
    setSession(null);
    setSelectedCandidate(null);
    try {
      const newSess = await api.avatarBegin({
        description: description.trim(),
        style: selectedStyle,
        botId: currentBot?.id,
        reference: referenceUrl || undefined,
      });
      setSession(newSess);
      const drawingSess = await api.avatarStart(newSess.id);
      setSession(drawingSess);
      showToast('开始生成 4 组形象候选方案...', 'info');
    } catch (e: any) {
      showToast(`发起失败: ${e.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  // 选用候选
  const handleChooseCandidate = async (index: number) => {
    if (!session) return;
    setBusy(`choose-${index}`);
    try {
      const posingSess = await api.avatarChoose(session.id, index, currentBot?.id);
      setSession(posingSess);
      showToast('已选定候选，正在生成 5 种情绪全套姿态...', 'info');
      if (posingSess.stage === 'done') {
        const fresh = await api.avatarStatus(currentBot?.id);
        setStudioStatus(fresh);
        await loadBots();
      }
    } catch (e: any) {
      showToast(`选定失败: ${e.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  // 一键应用预设形象
  const handleApplyPreset = async (preset: AvatarPreset) => {
    if (!currentBot) return;
    setBusy(`preset-${preset.id}`);
    try {
      const updated = await api.updateBot(currentBot.id, {
        avatar: preset.id,
        avatarType: preset.id === 'dragon' ? 'dragon' : 'preset',
      });
      showToast(`已装配形象「${preset.name}」！`, 'info');
      await loadBots();
      onApplied?.(updated);
      fetchStatus();
    } catch (e: any) {
      showToast(`装配失败: ${e.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  // 一键应用自定义专属形象
  const handleApplyCustomFace = async (face: AvatarFaceMeta) => {
    if (!currentBot) return;
    setBusy(`face-${face.id}`);
    try {
      const updated = await api.updateBot(currentBot.id, {
        avatar: face.id,
        avatarType: 'custom',
      });
      showToast(`已成功装配形象！`, 'info');
      await loadBots();
      onApplied?.(updated);
      fetchStatus();
    } catch (e: any) {
      showToast(`装配失败: ${e.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  // 删除指定的自定义专属形象（两步内联倒计时确认）
  const handleDeleteCustomFace = async (faceId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (confirmDeleteId !== faceId) {
      setConfirmDeleteId(faceId);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => {
        setConfirmDeleteId(null);
        deleteTimerRef.current = null;
      }, 3500);
      return;
    }

    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    setConfirmDeleteId(null);
    setBusy(`del-${faceId}`);
    try {
      await api.deleteCustomAvatar(faceId);
      showToast('形象已成功删除', 'info');
      await fetchStatus();
      await loadBots();
    } catch (e: any) {
      showToast(`删除失败: ${e.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  // 重绘姿态
  const handleRedrawMoods = async () => {
    if (!currentBot) return;
    setBusy('redraw');
    try {
      const s = await api.avatarMoods(currentBot.id);
      setSession(s);
      showToast('正在重新生成情绪姿态...', 'info');
    } catch (e: any) {
      showToast(`重绘失败: ${e.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  // 恢复内置形象
  const handleResetToBuiltin = async () => {
    if (!currentBot) return;
    setBusy('reset');
    try {
      const updated = await api.updateBot(currentBot.id, {
        avatar: 'dragon',
        avatarType: 'dragon',
      });
      showToast('已恢复为内置形象', 'info');
      await loadBots();
      onApplied?.(updated);
      fetchStatus();
    } catch (e: any) {
      showToast(`恢复失败: ${e.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  // 上传参考图
  const handleUploadReference = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await api.uploadFile(file);
      setReferenceUrl(res.url);
      showToast('参考图已上传', 'info');
    } catch (err: any) {
      showToast(`上传失败: ${err.message}`, 'error');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="虚拟形象工坊 (Avatar Studio)"
      maxWidth="940px"
      zIndex={zIndex ?? 2100}
    >
      <div className="avatar-studio-layout">
        {/* 左侧：虚拟形象交互展示台 (Live Stage) */}
        <div className="avatar-stage-panel">
          <div className="avatar-stage-eyebrow">
            智能体舞台 · 实时姿态
          </div>

          {/* 舞台核心大头像 */}
          <div className="avatar-stage-avatar-wrap">
            <BotAvatar
              bot={currentBot}
              size={136}
              mood={stageMood}
              motion="avatar-idle"
              interactive={true}
            />
          </div>

          <div className="avatar-stage-bot-info">
            <div className="avatar-stage-bot-name">
              {currentBot?.name || '数字员工'}
            </div>
            <div
              className="avatar-stage-bot-desc"
              title={studioStatus?.face?.description || currentBot?.avatar || '默认'}
            >
              当前形象: {studioStatus?.face?.description ? studioStatus.face.description.slice(0, 24) + '...' : currentBot?.avatar || '默认'}
            </div>
          </div>

          {/* 5 情绪快速切换药丸栏 */}
          <div className="avatar-stage-moods-section">
            <div className="avatar-stage-moods-header">
              <span className="avatar-stage-moods-label">
                切换情绪状态:
              </span>
              <button
                type="button"
                onClick={() => setIsAutoCycle(!isAutoCycle)}
                className={`avatar-stage-cycle-btn ${isAutoCycle ? 'is-active' : ''}`}
              >
                <Play size={10} /> {isAutoCycle ? '停止轮播' : '自动轮播'}
              </button>
            </div>
            <div className="avatar-stage-moods-grid">
              {MOODS_LIST.map((m) => {
                const isSelected = stageMood === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setStageMood(m);
                      setIsAutoCycle(false);
                    }}
                    className={`avatar-stage-mood-pill ${isSelected ? 'is-active' : ''}`}
                  >
                    {m === 'idle' && '待机'}
                    {m === 'working' && '工作'}
                    {m === 'waiting' && '思考'}
                    {m === 'happy' && '喜悦'}
                    {m === 'error' && '纠错'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 底部重绘与恢复操作 */}
          <div className="avatar-stage-actions">
            {studioStatus?.face?.model !== 'preset' && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={handleRedrawMoods}
                className="btn-secondary avatar-stage-redraw-btn"
              >
                <RotateCcw size={13} className={busy === 'redraw' ? 'animate-spin' : ''} />
                重新生成 4 种情绪姿态
              </button>
            )}

            {currentBot?.avatar !== 'dragon' && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={handleResetToBuiltin}
                className="btn-secondary avatar-stage-reset-btn"
              >
                恢复内置形象
              </button>
            )}
          </div>
        </div>

        {/* 右侧：创作工作区与形象馆 Tabs */}
        <div className="avatar-studio-workspace">
          {/* Tab 导航栏 */}
          <div className="avatar-studio-tabs">
            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className={`avatar-studio-tab-btn ${activeTab === 'create' ? 'is-active' : ''}`}
            >
              <Sparkles size={16} /> AI 智能创作
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('presets')}
              className={`avatar-studio-tab-btn ${activeTab === 'presets' ? 'is-active' : ''}`}
            >
              <Compass size={16} /> 形象图库 (预设与历史)
            </button>
          </div>

          {/* Tab 1: AI 智能创作 */}
          {activeTab === 'create' && (
            <div className="avatar-studio-container">
              {/* 独立生图引擎状态指示栏 & 快捷配置入口 */}
              <div className={`avatar-engine-banner ${studioStatus?.cloud ? 'is-cloud' : 'is-local'}`}>
                <div>
                  <div className="avatar-engine-title-row">
                    <span className="avatar-engine-title">
                      {studioStatus?.cloud
                        ? `⚡ 绘图引擎: ${studioStatus?.provider} (${studioStatus?.imageModel})`
                        : '🎨 绘图引擎: 智能自适应矢量引擎 (离线本地绘图模式)'}
                    </span>
                    <span className="avatar-engine-badge">
                      {studioStatus?.cloud ? '商业云端' : '本地离线'}
                    </span>
                  </div>
                  <div className="avatar-engine-sub">
                    {studioStatus?.cloud
                      ? '已独立连接专用生图大模型，与对话模型完全隔离'
                      : '提示：可随时点击右侧按钮连接硅基流动、Google 或通义万相'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsImageModelModalOpen(true)}
                  className="avatar-engine-config-btn"
                >
                  <Settings size={13} /> 配置生图引擎
                </button>
              </div>

              {/* 最近生成的专属形象 */}
              <div className="avatar-form-block">
                <div className="avatar-section-title-row">
                  <span className="avatar-section-label">
                    最近生成的形象 (点击卡片填充描述，或直接「立即装配」):
                  </span>
                  {studioStatus?.customFaces && studioStatus.customFaces.length > 0 && (
                    <span className="avatar-section-count">
                      共 {studioStatus.customFaces.length} 款历史创作
                    </span>
                  )}
                </div>

                {(!studioStatus?.customFaces || studioStatus.customFaces.length === 0) ? (
                  <div className="avatar-empty-state">
                    暂无历史生成的形象。在下方输入描述并点击「开始绘制」，生成的形象将自动陈列于此。
                  </div>
                ) : (
                  <div className="avatar-recent-strip">
                    {[...(studioStatus?.customFaces || [])]
                      .sort((a, b) => (b.created || 0) - (a.created || 0))
                      .map((face) => {
                        const isEquipped = currentBot?.avatar === face.id;
                        const isDescSelected = description === face.description;
                        const styleInfo = STYLES_CATALOG.find((s) => s.id === face.style);
                        const imgUrl = face.moods?.idle || `/avatars/custom/${face.id}/idle.webp`;
                        const isConfirming = confirmDeleteId === face.id;

                        return (
                          <div
                            key={face.id}
                            onClick={() => {
                              if (face.description) setDescription(face.description);
                              if (face.style) setSelectedStyle(face.style as AvatarStyle);
                            }}
                            className={`avatar-face-card ${isEquipped ? 'is-equipped' : ''} ${isDescSelected ? 'is-selected' : ''}`}
                            title={`点击填充描述: ${face.description}`}
                          >
                            {/* 缩略图与操作按钮 */}
                            <div className="avatar-face-img-wrap">
                              <img
                                src={imgUrl}
                                alt={face.description || face.id}
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).src = '/avatars/dragon-idle.webp';
                                }}
                              />
                              {isEquipped && (
                                <span className="avatar-face-badge-equipped">
                                  使用中
                                </span>
                              )}
                              {/* 删除按钮 (两步内联倒计时确认) */}
                              <button
                                type="button"
                                title={isConfirming ? '再次点击确认删除' : '删除该形象'}
                                onClick={(e) => handleDeleteCustomFace(face.id, e)}
                                className={`avatar-face-delete-btn ${isConfirming ? 'is-confirming' : ''}`}
                              >
                                {isConfirming ? '确认删除?' : <Trash2 size={11} />}
                              </button>
                            </div>

                            {/* 描述与风格 */}
                            <div className="avatar-face-meta">
                              <div className="avatar-face-desc" title={face.description || '自定义形象'}>
                                {face.description || '自定义形象'}
                              </div>

                              <div className="avatar-face-footer">
                                <span className="avatar-face-style-tag">
                                  {styleInfo?.label.split(' ')[0] || face.style || '默认'}
                                </span>

                                <button
                                  type="button"
                                  disabled={isEquipped || busy !== null}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleApplyCustomFace(face);
                                  }}
                                  className={`avatar-face-equip-btn ${isEquipped ? 'btn-secondary' : 'btn-primary'}`}
                                >
                                  {isEquipped ? '已装配' : '立即装配'}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* 描述输入框 */}
              <div className="avatar-form-block">
                <label className="avatar-field-label">
                  形象外貌与角色描述:
                </label>
                <textarea
                  className="avatar-textarea"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="例如：一只软萌治愈系小柴犬，系着红蓝格子围巾..."
                />
              </div>

              {/* 灵感词快捷填入 */}
              <div className="avatar-form-block">
                <span className="avatar-field-label" style={{ fontSize: '11.5px', color: 'var(--om-muted)' }}>
                  快捷灵感词:
                </span>
                <div className="avatar-suggestion-chips">
                  {PROMPT_SUGGESTIONS.map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setDescription(item)}
                      className="avatar-suggestion-chip"
                    >
                      {item.slice(0, 16)}...
                    </button>
                  ))}
                </div>
              </div>

              {/* 风格选择器 */}
              <div className="avatar-form-block">
                <label className="avatar-field-label">
                  艺术风格体系 (7 种):
                </label>
                <div className="avatar-styles-grid">
                  {STYLES_CATALOG.map((s) => {
                    const isSelected = selectedStyle === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedStyle(s.id)}
                        title={`${s.label}：${s.desc}`}
                        className={`avatar-style-card ${isSelected ? 'is-selected' : ''}`}
                      >
                        <div className="avatar-style-header">
                          <span>{s.icon}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                        </div>
                        <div className="avatar-style-desc" title={s.desc}>
                          {s.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 参考图附件 (可选) */}
              <div className="avatar-upload-row">
                <label className="avatar-upload-btn">
                  <Upload size={13} />
                  <span>{referenceUrl ? '更换参考图' : '上传参考图 (可选)'}</span>
                  <input type="file" accept="image/*" onChange={handleUploadReference} style={{ display: 'none' }} />
                </label>
                {referenceUrl && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--accent-green, #10b981)' }}>
                    <Check size={14} /> 已上传参考底图
                    <button
                      type="button"
                      onClick={() => setReferenceUrl('')}
                      style={{ background: 'none', border: 'none', color: 'var(--accent-red, #ef4444)', cursor: 'pointer', padding: 0 }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>

              {/* 生成按钮 */}
              <div>
                <button
                  type="button"
                  disabled={busy !== null || !description.trim()}
                  onClick={handleBeginAndStart}
                  className="btn-primary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '9px 20px',
                    fontSize: '13.5px',
                    fontWeight: 650,
                    borderRadius: '8px',
                  }}
                >
                  {busy === 'draw' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  开始绘制四宫格候选
                </button>
              </div>

              {/* 候选四宫格展示区 */}
              {session && (session.stage === 'drawing' || session.stage === 'choose' || session.stage === 'posing') && (
                <div className="avatar-candidates-box">
                  <div className="avatar-candidates-header">
                    <span style={{ fontSize: '12.5px', fontWeight: 650, color: 'var(--om-fg)' }}>
                      {session.stage === 'drawing' ? '正在并行生成 4 组形象候选方案...' : '点击任一款定型生成全套情绪姿态:'}
                    </span>
                    {session.stage === 'choose' && (
                      <button
                        type="button"
                        onClick={() => api.avatarStart(session.id)}
                        className="btn-secondary"
                        style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <RefreshCw size={11} /> 换一批
                      </button>
                    )}
                  </div>

                  <div className="avatar-candidates-grid">
                    {session.candidates.map((cand, idx) => {
                      const isChosen = selectedCandidate === idx || session.chosen === idx;
                      return (
                        <div
                          key={idx}
                          className={`avatar-candidate-cell ${isChosen ? 'is-chosen' : ''}`}
                          style={{ cursor: session.stage === 'choose' && cand ? 'pointer' : 'default' }}
                          onClick={() => {
                            if (session.stage === 'choose' && cand && busy === null) {
                              setSelectedCandidate(selectedCandidate === idx ? null : idx);
                            }
                          }}
                        >
                          {cand ? (
                            <img src={cand} alt={`候选 ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Loader2 size={18} className="animate-spin text-muted" />
                            </div>
                          )}
                          <span className="avatar-candidate-tag">
                            #{idx + 1}
                          </span>
                          {isChosen && (
                            <span className="avatar-candidate-check">
                              <Check size={12} />
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* 选定并开始生成姿态操作条 */}
                  {selectedCandidate !== null && session.stage === 'choose' && (
                    <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => handleChooseCandidate(selectedCandidate)}
                        className="btn-primary"
                        style={{
                          width: '100%',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          padding: '10px',
                          fontSize: '13px',
                          fontWeight: 650,
                          borderRadius: '8px',
                        }}
                      >
                        {busy === `choose-${selectedCandidate}` ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                        就用这张 (定型生成全套 5 态)
                      </button>
                      <p style={{ textAlign: 'center', fontSize: '11.5px', color: 'var(--om-muted)', margin: 0 }}>
                        接下来，系统将以此为基准生成全套 5 种情绪姿态（待机、工作、思考、喜悦、纠错）。
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 姿态生成成功完成态 */}
              {session?.stage === 'done' && session.moods && (
                <div className="avatar-done-box">
                  <div className="avatar-done-title">
                    <Check size={16} /> 形象全套姿态已成功装配至「{currentBot?.name}」！
                  </div>
                  <div className="avatar-done-moods-row">
                    {MOODS_LIST.map((m) => (
                      <div key={m} className="avatar-done-mood-item">
                        <div className="avatar-done-mood-thumb">
                          <img src={session.moods?.[m]} alt={m} />
                        </div>
                        <span className="avatar-done-mood-label">
                          {MOOD_NAMES[m]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: 形象图库 (预设与历史) */}
          {activeTab === 'presets' && (
            <div className="avatar-studio-container">
              {/* 系统内置预设 */}
              <div className="avatar-form-block">
                <span className="avatar-field-label" style={{ marginBottom: '8px' }}>
                  系统内置预设
                </span>
                <div className="avatar-presets-grid">
                  {(studioStatus?.presets || []).map((preset) => {
                    const isSelected = currentBot?.avatar === preset.id;
                    return (
                      <div
                        key={preset.id}
                        className={`avatar-preset-card ${isSelected ? 'is-selected' : ''}`}
                      >
                        <div style={{ flexShrink: 0 }}>
                          <BotAvatar bot={{ avatar: preset.id } as any} size={52} motion="avatar-idle" />
                        </div>
                        <div className="avatar-preset-info">
                          <div className="avatar-preset-title-line">
                            <span className="avatar-preset-title">
                              {preset.name}
                            </span>
                            {preset.clips && (
                              <span style={{ fontSize: '10px', color: 'var(--om-accent)', background: 'color-mix(in srgb, var(--om-accent) 12%, transparent)', padding: '1px 5px', borderRadius: '4px' }}>
                                含视频动态
                              </span>
                            )}
                          </div>
                          <span className="avatar-preset-desc">
                            {preset.description}
                          </span>
                          <button
                            type="button"
                            disabled={isSelected || busy !== null}
                            onClick={() => handleApplyPreset(preset)}
                            className={isSelected ? 'btn-secondary' : 'btn-primary'}
                            style={{
                              marginTop: 'auto',
                              padding: '4px 10px',
                              fontSize: '11.5px',
                              borderRadius: '6px',
                              alignSelf: 'flex-start',
                            }}
                          >
                            {isSelected ? '当前使用中' : '立即装配'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 历史生成的专属形象 */}
              <div className="avatar-form-block">
                <div className="avatar-section-title-row">
                  <span className="avatar-field-label">
                    历史生成的专属形象
                  </span>
                  {studioStatus?.customFaces && studioStatus.customFaces.length > 0 && (
                    <span className="avatar-section-count">
                      共 {studioStatus.customFaces.length} 款历史创作
                    </span>
                  )}
                </div>

                {(!studioStatus?.customFaces || studioStatus.customFaces.length === 0) ? (
                  <div className="avatar-empty-state">
                    暂无生成的自定义专属形象。可在「AI 智能创作」中输入提示词绘制。
                  </div>
                ) : (
                  <div className="avatar-presets-grid">
                    {[...(studioStatus?.customFaces || [])]
                      .sort((a, b) => (b.created || 0) - (a.created || 0))
                      .map((face) => {
                        const isEquipped = currentBot?.avatar === face.id;
                        const styleInfo = STYLES_CATALOG.find((s) => s.id === face.style);
                        const isConfirming = confirmDeleteId === face.id;

                        return (
                          <div
                            key={face.id}
                            className={`avatar-preset-card ${isEquipped ? 'is-selected' : ''}`}
                            style={isEquipped ? { borderColor: 'var(--accent-green, #10b981)', background: 'rgba(16, 185, 129, 0.05)' } : undefined}
                          >
                            <div style={{ flexShrink: 0 }}>
                              <BotAvatar bot={{ avatar: face.id, avatarType: 'custom' } as any} size={52} motion="avatar-idle" />
                            </div>
                            <div className="avatar-preset-info">
                              <div className="avatar-preset-title-line">
                                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--om-accent)', background: 'color-mix(in srgb, var(--om-accent) 12%, transparent)', padding: '1px 5px', borderRadius: '4px' }}>
                                  {styleInfo?.label.split(' ')[0] || face.style || '自定义'}
                                </span>
                                {isEquipped && (
                                  <span style={{ fontSize: '10.5px', color: 'var(--accent-green, #10b981)', fontWeight: 650 }}>
                                    当前佩戴中
                                  </span>
                                )}
                              </div>
                              <span
                                className="avatar-preset-desc"
                                title={face.description || '自定义形象'}
                              >
                                {face.description || '自定义形象'}
                              </span>
                              <div style={{ marginTop: 'auto', paddingTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--om-border)' }}>
                                <span style={{ fontSize: '10px', color: 'var(--om-muted)' }}>
                                  {face.created ? new Date(face.created).toLocaleDateString() : ''}
                                </span>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (face.description) setDescription(face.description);
                                      if (face.style) setSelectedStyle(face.style as AvatarStyle);
                                      setActiveTab('create');
                                    }}
                                    className="btn-secondary"
                                    style={{ padding: '3px 8px', fontSize: '11px', borderRadius: '6px' }}
                                  >
                                    复用描述
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isEquipped || busy !== null}
                                    onClick={() => handleApplyCustomFace(face)}
                                    className={isEquipped ? 'btn-secondary' : 'btn-primary'}
                                    style={{
                                      padding: '3px 9px',
                                      fontSize: '11px',
                                      borderRadius: '6px',
                                      background: isEquipped ? undefined : 'var(--accent-green, #10b981)',
                                      borderColor: isEquipped ? undefined : 'var(--accent-green, #10b981)',
                                    }}
                                  >
                                    {isEquipped ? '已装配' : '立即装配'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy !== null}
                                    onClick={(e) => handleDeleteCustomFace(face.id, e)}
                                    className={`btn-secondary ${isConfirming ? 'is-confirming' : ''}`}
                                    style={{
                                      padding: '3px 7px',
                                      fontSize: '11px',
                                      borderRadius: '6px',
                                      color: isConfirming ? '#ffffff' : 'var(--accent-red, #ef4444)',
                                      backgroundColor: isConfirming ? 'var(--accent-red, #ef4444)' : undefined,
                                      borderColor: isConfirming ? 'var(--accent-red, #ef4444)' : undefined,
                                    }}
                                    title={isConfirming ? '再次点击确认删除' : '删除此形象'}
                                  >
                                    {isConfirming ? '确认删除?' : <Trash2 size={12} />}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

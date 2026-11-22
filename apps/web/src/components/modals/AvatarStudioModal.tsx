import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  RefreshCw,
  Check,
  X,
  Upload,
  Loader2,
  Film,
  Image as ImageIcon,
  Smile,
  Compass,
  Palette,
  Play,
  RotateCcw,
  Settings,
  Trash2,
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

  const [activeTab, setActiveTab] = useState<'create' | 'presets' | 'custom'>('create');
  const [studioStatus, setStudioStatus] = useState<AvatarStudioView | null>(null);
  const [stageMood, setStageMood] = useState<AvatarMood>('idle');
  const [isAutoCycle, setIsAutoCycle] = useState(false);

  useEffect(() => {
    if (!isImageModelModalOpen) {
      fetchStatus();
    }
  }, [isImageModelModalOpen]);

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
    if (isOpen) {
      fetchStatus();
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    }
  }, [isOpen, currentBot?.id]);

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

  // 删除指定的自定义专属形象
  const handleDeleteCustomFace = async (faceId: string, desc?: string) => {
    const hint = desc ? `「${desc.slice(0, 12)}...」` : '';
    if (!window.confirm(`确定要彻底删除该历史形象 ${hint} 吗？此操作无法撤销。`)) {
      return;
    }
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
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '24px 18px',
            background: 'var(--om-surface-2, #f9fafb)',
            borderRadius: '16px',
            border: '1px solid var(--om-border, #e5e7eb)',
            position: 'sticky',
            top: 0,
            alignSelf: 'flex-start',
            zIndex: 10,
          }}
        >
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--om-muted, #6b7280)', textTransform: 'uppercase', marginBottom: '14px' }}>
            智能体舞台 · 实时姿态
          </div>

          {/* 舞台核心大头像 */}
          <div style={{ margin: '14px 0 18px' }}>
            <BotAvatar
              bot={currentBot}
              size={136}
              mood={stageMood}
              motion="avatar-idle"
              interactive={true}
            />
          </div>

          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--om-fg, #111827)' }}>
              {currentBot?.name || '数字员工'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--om-muted, #6b7280)', marginTop: '2px' }}>
              当前形象: {studioStatus?.face?.description ? studioStatus.face.description.slice(0, 24) + '...' : currentBot?.avatar || '默认'}
            </div>
          </div>

          {/* 5 情绪快速切换药丸栏 */}
          <div style={{ width: '100%', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--om-muted, #6b7280)' }}>
                切换情绪状态:
              </span>
              <button
                type="button"
                onClick={() => setIsAutoCycle(!isAutoCycle)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '11px',
                  color: isAutoCycle ? 'var(--om-accent, #3b82f6)' : 'var(--om-muted, #9ca3af)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <Play size={10} /> {isAutoCycle ? '停止轮播' : '自动轮播'}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
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
                    style={{
                      padding: '6px 2px',
                      fontSize: '11px',
                      borderRadius: '6px',
                      border: isSelected ? '1px solid var(--om-accent, #3b82f6)' : '1px solid var(--om-border, #e5e7eb)',
                      background: isSelected ? 'var(--om-accent, #3b82f6)' : 'var(--om-surface, #ffffff)',
                      color: isSelected ? '#ffffff' : 'var(--om-fg, #374151)',
                      cursor: 'pointer',
                      fontWeight: isSelected ? 600 : 400,
                      textAlign: 'center',
                    }}
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

          {/* 底部重绘操作 */}
          {studioStatus?.face?.model !== 'preset' && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={handleRedrawMoods}
              className="btn-secondary"
              style={{
                width: '100%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '8px',
                fontSize: '12px',
                borderRadius: '8px',
                marginTop: 'auto',
              }}
            >
              <RotateCcw size={13} className={busy === 'redraw' ? 'animate-spin' : ''} />
              重新生成 4 种情绪姿态
            </button>
          )}

          {/* 恢复内置形象 */}
          {currentBot?.avatar !== 'dragon' && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={handleResetToBuiltin}
              className="btn-secondary"
              style={{
                width: '100%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                padding: '7px',
                fontSize: '11.5px',
                borderRadius: '8px',
                marginTop: '6px',
                color: 'var(--om-muted, #6b7280)',
              }}
            >
              恢复内置形象
            </button>
          )}
        </div>

        {/* 右侧：创作工作区与形象馆 Tabs */}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, width: '100%', overflow: 'hidden' }}>
          {/* Tab 导航栏 */}
          <div
            style={{
              display: 'flex',
              gap: '12px',
              borderBottom: '1px solid var(--om-border, #e5e7eb)',
              paddingBottom: '10px',
              marginBottom: '18px',
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('create')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13.5px',
                fontWeight: activeTab === 'create' ? 700 : 500,
                color: activeTab === 'create' ? 'var(--om-accent, #3b82f6)' : 'var(--om-muted, #6b7280)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 6px',
              }}
            >
              <Sparkles size={16} /> AI 智能创作
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('presets')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13.5px',
                fontWeight: activeTab === 'presets' ? 700 : 500,
                color: activeTab === 'presets' ? 'var(--om-accent, #3b82f6)' : 'var(--om-muted, #6b7280)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 6px',
              }}
            >
              <Compass size={16} /> 形象图库 (预设与历史)
            </button>
          </div>

          {/* Tab 1: AI 智能创作 */}
          {activeTab === 'create' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minWidth: 0, width: '100%', overflowY: 'auto', maxHeight: '560px', paddingRight: '4px' }}>
              {/* 独立生图引擎状态指示栏 & 快捷配置入口 */}
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  background: studioStatus?.cloud ? 'rgba(139, 92, 246, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                  border: studioStatus?.cloud ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid rgba(245, 158, 11, 0.25)',
                  fontSize: '12px',
                  color: studioStatus?.cloud ? '#7c3aed' : '#b45309',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 600 }}>
                      {studioStatus?.cloud
                        ? `⚡ 绘图引擎: ${studioStatus?.provider} (${studioStatus?.imageModel})`
                        : '🎨 绘图引擎: 智能自适应矢量引擎 (离线本地绘图模式)'}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '1px 6px',
                        borderRadius: '10px',
                        background: studioStatus?.cloud ? 'rgba(139, 92, 246, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                        fontWeight: 500,
                      }}
                    >
                      {studioStatus?.cloud ? '商业云端' : '本地离线'}
                    </span>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--om-muted, #6b7280)' }}>
                    {studioStatus?.cloud
                      ? '已独立连接专用生图大模型，与对话模型完全隔离'
                      : '提示：可随时点击右侧按钮连接硅基流动、Google 或通义万相'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsImageModelModalOpen(true)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: '#8b5cf6',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 1px 3px rgba(139, 92, 246, 0.3)',
                  }}
                >
                  <Settings size={13} /> 配置生图引擎
                </button>
              </div>

              {/* 最近生成的专属形象 */}
              <div style={{ width: '100%', minWidth: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--om-muted, #6b7280)', textTransform: 'uppercase' }}>
                    最近生成的形象 (点击卡片填充描述，或直接「立即装配」):
                  </span>
                  {studioStatus?.customFaces && studioStatus.customFaces.length > 0 && (
                    <span style={{ fontSize: '10.5px', color: 'var(--om-muted, #9ca3af)' }}>
                      共 {studioStatus.customFaces.length} 款历史创作
                    </span>
                  )}
                </div>

                {(!studioStatus?.customFaces || studioStatus.customFaces.length === 0) ? (
                  <div
                    style={{
                      padding: '16px',
                      textAlign: 'center',
                      borderRadius: '10px',
                      background: 'var(--om-surface, #f9fafb)',
                      border: '1px dashed var(--om-border, #e5e7eb)',
                      fontSize: '12px',
                      color: 'var(--om-muted, #6b7280)',
                    }}
                  >
                    暂无历史生成的形象。在下方输入描述并点击「开始绘制」，生成的形象将自动陈列于此。
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      gap: '10px',
                      overflowX: 'auto',
                      paddingBottom: '8px',
                      paddingTop: '2px',
                      scrollbarWidth: 'thin',
                      width: '100%',
                      minWidth: 0,
                      maxWidth: '100%',
                    }}
                  >
                    {[...(studioStatus?.customFaces || [])]
                      .sort((a, b) => (a.created || 0) - (b.created || 0))
                      .map((face) => {
                        const isEquipped = currentBot?.avatar === face.id;
                        const isDescSelected = description === face.description;
                        const styleInfo = STYLES_CATALOG.find((s) => s.id === face.style);
                        const imgUrl = face.moods?.idle || `/avatars/custom/${face.id}/idle.webp`;

                        return (
                          <div
                            key={face.id}
                            onClick={() => {
                              if (face.description) setDescription(face.description);
                              if (face.style) setSelectedStyle(face.style as AvatarStyle);
                            }}
                            style={{
                              flex: '0 0 148px',
                              width: '148px',
                              overflow: 'hidden',
                              borderRadius: '12px',
                              border: isEquipped
                                ? '2px solid #10b981'
                                : isDescSelected
                                ? '2px solid var(--om-accent, #3b82f6)'
                                : '1px solid var(--om-border, #e5e7eb)',
                              background: isEquipped
                                ? 'rgba(16, 185, 129, 0.05)'
                                : isDescSelected
                                ? 'rgba(59, 130, 246, 0.05)'
                                : 'var(--om-surface, #ffffff)',
                              display: 'flex',
                              flexDirection: 'column',
                              cursor: 'pointer',
                              position: 'relative',
                              transition: 'all 0.15s ease',
                              boxShadow: isEquipped ? '0 2px 6px rgba(16,185,129,0.15)' : 'none',
                            }}
                            title={`点击填充描述: ${face.description}`}
                          >
                            {/* 缩略图与操作按钮 */}
                            <div style={{ aspectRatio: '1/1', background: '#f3f4f6', overflow: 'hidden', position: 'relative' }}>
                              <img
                                src={imgUrl}
                                alt={face.description || face.id}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).src = '/avatars/dragon-idle.webp';
                                }}
                              />
                              {isEquipped && (
                                <span
                                  style={{
                                    position: 'absolute',
                                    top: '4px',
                                    right: '4px',
                                    background: '#10b981',
                                    color: '#fff',
                                    fontSize: '9.5px',
                                    fontWeight: 700,
                                    padding: '1px 5px',
                                    borderRadius: '4px',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                  }}
                                >
                                  使用中
                                </span>
                              )}
                              {/* 删除按钮 */}
                              <button
                                type="button"
                                title="删除该形象"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteCustomFace(face.id, face.description);
                                }}
                                style={{
                                  position: 'absolute',
                                  top: '4px',
                                  left: '4px',
                                  width: '22px',
                                  height: '22px',
                                  borderRadius: '50%',
                                  background: 'rgba(0,0,0,0.45)',
                                  color: '#fff',
                                  border: 'none',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  transition: 'all 0.15s ease',
                                  zIndex: 3,
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#ef4444')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.45)')}
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>

                            {/* 描述与风格 */}
                            <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: '60px' }}>
                              <div
                                style={{
                                  fontSize: '11px',
                                  color: 'var(--om-fg, #111827)',
                                  lineHeight: '1.3',
                                  maxHeight: '2.6em',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  marginBottom: '4px',
                                }}
                              >
                                {face.description || '自定义形象'}
                              </div>

                              <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                                <span
                                  style={{
                                    fontSize: '9.5px',
                                    color: 'var(--om-muted, #6b7280)',
                                    background: 'rgba(0,0,0,0.04)',
                                    padding: '1px 4px',
                                    borderRadius: '3px',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {styleInfo?.label.split(' ')[0] || face.style || '默认'}
                                </span>

                                <button
                                  type="button"
                                  disabled={isEquipped || busy !== null}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleApplyCustomFace(face);
                                  }}
                                  style={{
                                    padding: '2px 7px',
                                    fontSize: '10.5px',
                                    fontWeight: 600,
                                    borderRadius: '5px',
                                    border: 'none',
                                    cursor: isEquipped ? 'default' : 'pointer',
                                    background: isEquipped ? '#10b981' : 'var(--om-accent, #3b82f6)',
                                    color: '#fff',
                                    whiteSpace: 'nowrap',
                                    opacity: busy && busy.startsWith('face-') ? 0.6 : 1,
                                  }}
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
              <div>
                <label style={{ fontSize: '12.5px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  形象外貌与角色描述:
                </label>
                <textarea
                  className="form-control"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="例如：一只软萌治愈系小柴犬，系着红蓝格子围巾..."
                  style={{ width: '100%', fontSize: '13px', resize: 'vertical' }}
                />
              </div>

              {/* 灵感词快捷填入 */}
              <div>
                <span style={{ fontSize: '11px', color: 'var(--om-muted, #9ca3af)', display: 'block', marginBottom: '4px' }}>
                  快捷灵感词:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  {PROMPT_SUGGESTIONS.map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setDescription(item)}
                      style={{
                        padding: '3px 8px',
                        fontSize: '11px',
                        borderRadius: '12px',
                        background: 'var(--om-surface-2, #f3f4f6)',
                        border: '1px solid var(--om-border, #e5e7eb)',
                        color: 'var(--om-fg, #374151)',
                        cursor: 'pointer',
                      }}
                    >
                      {item.slice(0, 14)}...
                    </button>
                  ))}
                </div>
              </div>

              {/* 风格选择器 */}
              <div>
                <label style={{ fontSize: '12.5px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  艺术风格体系 (7 种):
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px', width: '100%' }}>
                  {STYLES_CATALOG.map((s) => {
                    const isSelected = selectedStyle === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedStyle(s.id)}
                        title={`${s.label}：${s.desc}`}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          padding: '6px 8px',
                          borderRadius: '8px',
                          border: isSelected ? '2px solid var(--om-accent, #3b82f6)' : '1px solid var(--om-border, #e5e7eb)',
                          background: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'var(--om-surface, #ffffff)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.15s ease',
                          minHeight: '48px',
                          minWidth: 0,
                          width: '100%',
                          overflow: 'hidden',
                          boxSizing: 'border-box',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 650, width: '100%', minWidth: 0, overflow: 'hidden' }}>
                          <span style={{ flexShrink: 0, fontSize: '12px' }}>{s.icon}</span>
                          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{s.label}</span>
                        </div>
                        <span style={{ fontSize: '9.5px', color: 'var(--om-muted, #6b7280)', marginTop: '2px', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%', minWidth: 0, display: 'block' }}>
                          {s.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 参考图附件 (可选) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    fontSize: '12px',
                    borderRadius: '8px',
                    border: '1px dashed var(--om-border, #d1d5db)',
                    background: 'var(--om-surface-2, #f9fafb)',
                    cursor: 'pointer',
                  }}
                >
                  <Upload size={13} />
                  <span>{referenceUrl ? '更换参考图' : '上传参考图 (可选)'}</span>
                  <input type="file" accept="image/*" onChange={handleUploadReference} style={{ display: 'none' }} />
                </label>
                {referenceUrl && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#10b981' }}>
                    <Check size={14} /> 已上传参考底图
                    <button
                      type="button"
                      onClick={() => setReferenceUrl('')}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0 }}
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
                    padding: '10px 22px',
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
                <div
                  style={{
                    marginTop: '12px',
                    padding: '14px',
                    borderRadius: '12px',
                    background: 'var(--om-surface-2, #f9fafb)',
                    border: '1px solid var(--om-border, #e5e7eb)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 650, color: 'var(--om-fg, #111827)' }}>
                      {session.stage === 'drawing' ? '正在并行生成 4 组形象候选方案...' : '点击任一款定型生成全套情绪姿态:'}
                    </span>
                    {session.stage === 'choose' && (
                      <button
                        type="button"
                        onClick={() => api.avatarStart(session.id)}
                        className="btn-secondary"
                        style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px' }}
                      >
                        <RefreshCw size={11} /> 换一批
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                    {session.candidates.map((cand, idx) => {
                      const isChosen = selectedCandidate === idx || session.chosen === idx;
                      return (
                        <div
                          key={idx}
                          style={{
                            position: 'relative',
                            aspectRatio: '1/1',
                            borderRadius: '10px',
                            overflow: 'hidden',
                            background: 'var(--om-surface, #ffffff)',
                            border: isChosen ? '2px solid var(--om-accent, #3b82f6)' : '1px solid var(--om-border, #e5e7eb)',
                            cursor: session.stage === 'choose' && cand ? 'pointer' : 'default',
                            boxShadow: isChosen ? '0 0 0 2px rgba(59, 130, 246, 0.2)' : 'none',
                          }}
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
                          <span
                            style={{
                              position: 'absolute',
                              top: '4px',
                              left: '4px',
                              background: 'rgba(0,0,0,0.6)',
                              color: '#ffffff',
                              fontSize: '10px',
                              fontWeight: 600,
                              padding: '1px 5px',
                              borderRadius: '4px',
                            }}
                          >
                            #{idx + 1}
                          </span>
                          {isChosen && (
                            <span
                              style={{
                                position: 'absolute',
                                top: '4px',
                                right: '4px',
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                background: 'var(--om-accent, #3b82f6)',
                                color: '#ffffff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                              }}
                            >
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
                      <p style={{ textAlign: 'center', fontSize: '11.5px', color: 'var(--om-muted, #6b7280)', margin: 0 }}>
                        接下来，系统将以此为基准生成全套 5 种情绪姿态（待机、工作、思考、喜悦、纠错）。
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* 姿态生成成功完成态 */}
              {session?.stage === 'done' && session.moods && (
                <div
                  style={{
                    marginTop: '12px',
                    padding: '14px',
                    borderRadius: '12px',
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontWeight: 650, fontSize: '13px' }}>
                    <Check size={16} /> 形象全套姿态已成功装配至「{currentBot?.name}」！
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    {MOODS_LIST.map((m) => (
                      <div key={m} style={{ width: '50px', textAlign: 'center' }}>
                        <div style={{ width: '48px', height: '48px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #d1d5db' }}>
                          <img src={session.moods?.[m]} alt={m} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                        <span style={{ fontSize: '10px', color: '#4b5563', marginTop: '2px', display: 'block' }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', overflowY: 'auto', maxHeight: '540px', paddingRight: '4px' }}>
              {/* 系统内置预设 */}
              <div>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--om-fg, #111827)', display: 'block', marginBottom: '8px' }}>
                  系统内置预设
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                  {(studioStatus?.presets || []).map((preset) => {
                    const isSelected = currentBot?.avatar === preset.id;
                    return (
                      <div
                        key={preset.id}
                        style={{
                          display: 'flex',
                          gap: '12px',
                          padding: '12px',
                          borderRadius: '12px',
                          border: isSelected ? '2px solid var(--om-accent, #3b82f6)' : '1px solid var(--om-border, #e5e7eb)',
                          background: isSelected ? 'rgba(59, 130, 246, 0.06)' : 'var(--om-surface, #ffffff)',
                        }}
                      >
                        <div style={{ flexShrink: 0 }}>
                          <BotAvatar bot={{ avatar: preset.id } as any} size={52} motion="avatar-idle" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '13px', fontWeight: 650, color: 'var(--om-fg, #111827)' }}>
                              {preset.name}
                            </span>
                            {preset.clips && (
                              <span style={{ fontSize: '10px', color: '#3b82f6', background: 'rgba(59,130,246,0.1)', padding: '1px 5px', borderRadius: '4px' }}>
                                含视频动态
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: '11px', color: 'var(--om-muted, #6b7280)', marginTop: '2px', lineHeight: 1.3 }}>
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

              {/* 最近生成的专属形象 */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--om-fg, #111827)' }}>
                    最近生成的专属形象
                  </span>
                  {studioStatus?.customFaces && studioStatus.customFaces.length > 0 && (
                    <span style={{ fontSize: '11px', color: 'var(--om-muted, #6b7280)' }}>
                      共 {studioStatus.customFaces.length} 款历史创作
                    </span>
                  )}
                </div>

                {(!studioStatus?.customFaces || studioStatus.customFaces.length === 0) ? (
                  <div
                    style={{
                      padding: '24px',
                      textAlign: 'center',
                      borderRadius: '10px',
                      background: 'var(--om-surface, #f9fafb)',
                      border: '1px dashed var(--om-border, #e5e7eb)',
                      fontSize: '12px',
                      color: 'var(--om-muted, #6b7280)',
                    }}
                  >
                    暂无生成的自定义专属形象。可在「AI 智能创作」中输入提示词绘制。
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                    {[...(studioStatus?.customFaces || [])]
                      .sort((a, b) => (a.created || 0) - (b.created || 0))
                      .map((face) => {
                        const isEquipped = currentBot?.avatar === face.id;
                        const styleInfo = STYLES_CATALOG.find((s) => s.id === face.style);
                        return (
                          <div
                            key={face.id}
                            style={{
                              display: 'flex',
                              gap: '12px',
                              padding: '12px',
                              borderRadius: '12px',
                              border: isEquipped ? '2px solid #10b981' : '1px solid var(--om-border, #e5e7eb)',
                              background: isEquipped ? 'rgba(16, 185, 129, 0.06)' : 'var(--om-surface, #ffffff)',
                            }}
                          >
                            <div style={{ flexShrink: 0 }}>
                              <BotAvatar bot={{ avatar: face.id, avatarType: 'custom' } as any} size={52} motion="avatar-idle" />
                            </div>
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '11px', fontWeight: 600, color: '#6366f1', background: 'rgba(99,102,241,0.08)', padding: '1px 5px', borderRadius: '4px' }}>
                                  {styleInfo?.label.split(' ')[0] || face.style || '自定义'}
                                </span>
                                {isEquipped && (
                                  <span style={{ fontSize: '10.5px', color: '#10b981', fontWeight: 650 }}>
                                    当前佩戴中
                                  </span>
                                )}
                              </div>
                              <span
                                style={{
                                  fontSize: '11.5px',
                                  color: 'var(--om-fg, #111827)',
                                  marginTop: '4px',
                                  lineHeight: 1.35,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                }}
                              >
                                {face.description || '自定义形象'}
                              </span>
                              <div style={{ marginTop: 'auto', paddingTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '10px', color: 'var(--om-muted, #9ca3af)' }}>
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
                                      background: isEquipped ? undefined : '#10b981',
                                      borderColor: isEquipped ? undefined : '#10b981',
                                    }}
                                  >
                                    {isEquipped ? '已装配' : '立即装配'}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy !== null}
                                    onClick={() => handleDeleteCustomFace(face.id, face.description)}
                                    className="btn-secondary"
                                    style={{ padding: '3px 7px', fontSize: '11px', borderRadius: '6px', color: '#ef4444' }}
                                    title="删除此形象"
                                  >
                                    <Trash2 size={12} />
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

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

const INSPIRATION_PRESETS = [
  {
    id: 'moss-courier',
    name: '苔邮使',
    desc: '戴叶子耳朵和信件包的迷你邮差',
    style: 'muse' as AvatarStyle,
    img: '/avatars/presets/moss-courier/idle.webp',
  },
  {
    id: 'tide-tinker',
    name: '潮汐巧匠',
    desc: '海沫色带珊瑚边缘的蝾螈工匠，带有简易工具袋',
    style: 'clay' as AvatarStyle,
    img: '/avatars/presets/tide-tinker/idle.webp',
  },
  {
    id: 'dusk-moth',
    name: '暮光蛾',
    desc: '戴圆眼镜与靛蓝水彩双翼的思考飞蛾，带浅米色领圈',
    style: 'watercolor' as AvatarStyle,
    img: '/avatars/presets/dusk-moth/idle.webp',
  },
  {
    id: 'copper-acorn',
    name: '铜果',
    desc: '橡果形纯铜机器人与鼠尾草色面板，围着沉静蓝色围巾',
    style: 'line' as AvatarStyle,
    img: '/avatars/presets/copper-acorn/idle.webp',
  },
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
  const { activeBot, showToast, loadBots } = useApp();
  const currentBot = targetBot || activeBot;

  const [activeTab, setActiveTab] = useState<'create' | 'presets' | 'custom'>('create');
  const [studioStatus, setStudioStatus] = useState<AvatarStudioView | null>(null);
  const [stageMood, setStageMood] = useState<AvatarMood>('idle');
  const [isAutoCycle, setIsAutoCycle] = useState(false);

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
        <div style={{ display: 'flex', flexDirection: 'column' }}>
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
              <Compass size={16} /> 预设形象馆
            </button>
          </div>

          {/* Tab 1: AI 智能创作 */}
          {activeTab === 'create' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
              {/* AI 灵感预设卡片 (4 款代表性风格效果预览) */}
              <div>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--om-muted, #6b7280)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
                  AI 灵感卡片 (点击自动填充描述与风格):
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                  {INSPIRATION_PRESETS.map((p) => {
                    const isSelected = description === p.desc && selectedStyle === p.style;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setDescription(p.desc);
                          setSelectedStyle(p.style);
                        }}
                        style={{
                          overflow: 'hidden',
                          borderRadius: '12px',
                          border: isSelected ? '2px solid var(--om-accent, #3b82f6)' : '1px solid var(--om-border, #e5e7eb)',
                          background: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'var(--om-surface, #ffffff)',
                          textAlign: 'left',
                          cursor: 'pointer',
                          padding: '0',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ aspectRatio: '1/1', background: '#f1efeb', overflow: 'hidden' }}>
                          <img src={p.img} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                        <div style={{ padding: '6px 8px' }}>
                          <div style={{ fontSize: '11.5px', fontWeight: 650, color: 'var(--om-fg, #111827)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {p.name}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--om-muted, #6b7280)' }}>
                            {STYLES_CATALOG.find((s) => s.id === p.style)?.label.split(' ')[0]}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {STYLES_CATALOG.map((s) => {
                    const isSelected = selectedStyle === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedStyle(s.id)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          border: isSelected ? '2px solid var(--om-accent, #3b82f6)' : '1px solid var(--om-border, #e5e7eb)',
                          background: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'var(--om-surface, #ffffff)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 650 }}>
                          <span>{s.icon}</span>
                          <span>{s.label}</span>
                        </div>
                        <span style={{ fontSize: '10.5px', color: 'var(--om-muted, #6b7280)', marginTop: '2px', lineHeight: 1.3 }}>
                          {s.desc.slice(0, 22)}...
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

          {/* Tab 2: 预设形象馆 */}
          {activeTab === 'presets' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px', overflowY: 'auto' }}>
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
          )}
        </div>
      </div>
    </Modal>
  );
};

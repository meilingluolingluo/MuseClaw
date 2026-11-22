import React, { useState } from 'react';
import { Sparkles, Loader2, RefreshCw, X, Check, Eye } from 'lucide-react';
import type { AvatarSession, AvatarMood } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';

interface AvatarOptionsCardProps {
  event: AvatarSession;
  botName?: string;
  onOpenStudio?: () => void;
  onUpdateEvent?: (updated: AvatarSession) => void;
}

const MOOD_LABELS: Record<AvatarMood, string> = {
  idle: '待机常态',
  working: '专注工作',
  waiting: '思考等待',
  happy: '喜悦完成',
  error: '歉意纠错',
};

export const AvatarOptionsCard: React.FC<AvatarOptionsCardProps> = ({
  event,
  botName = '智能体',
  onOpenStudio,
  onUpdateEvent,
}) => {
  const { showToast } = useApp();
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const act = async (action: string, fn: () => Promise<AvatarSession>) => {
    setBusyAction(action);
    try {
      const res = await fn();
      onUpdateEvent?.(res);
    } catch (e: any) {
      showToast(e.message || '操作失败', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const stage = event.stage;
  const isLive = ['estimate', 'drawing', 'choose', 'posing'].includes(stage);
  const cost = event.cost || {};

  return (
    <div className="avatar-options-card-wrap" style={{ margin: '8px 0', maxWidth: '420px', width: '100%' }}>
      <div
        className="avatar-card-container"
        style={{
          borderRadius: '16px',
          border: isLive ? '1px solid var(--om-accent, #3b82f6)' : '1px solid var(--om-border, #e5e7eb)',
          background: 'var(--om-surface, #ffffff)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.05)',
          overflow: 'hidden',
          transition: 'border-color 0.2s ease',
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 16px',
            background: isLive ? 'rgba(59, 130, 246, 0.06)' : 'var(--om-surface-2, #f9fafb)',
            borderBottom: '1px solid var(--om-border, #e5e7eb)',
          }}
        >
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isLive ? 'var(--om-accent, #3b82f6)' : 'var(--om-muted, #9ca3af)',
              color: '#ffffff',
              flexShrink: 0,
            }}
          >
            <Sparkles size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--om-muted, #6b7280)', textTransform: 'uppercase' }}>
              {stage === 'estimate' && `为 ${botName} 创作新虚拟形象`}
              {stage === 'drawing' && '正在生成 4 组候选方案...'}
              {stage === 'choose' && '挑选心仪形象：点击图片或输入序号'}
              {stage === 'posing' && '正在生成 5 种心情全套姿态...'}
              {stage === 'done' && '形象装配完成！已成功激活'}
              {stage === 'cancelled' && '已取消本次形象更换'}
              {stage === 'failed' && '形象生成中断'}
            </div>
            <div
              style={{
                fontSize: '13.5px',
                fontWeight: 600,
                color: 'var(--om-fg, #111827)',
                marginTop: '2px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={event.description}
            >
              {event.description}
            </div>
          </div>
        </div>

        {/* Stage 1: Estimate */}
        {stage === 'estimate' && (
          <div style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: '12.5px', color: 'var(--om-muted, #4b5563)', marginBottom: '14px', lineHeight: 1.5 }}>
              预计生成 {cost.pictures || 8} 张高保真切图（4 组多角度候选方案 + 4 种情绪动作姿态）。
              {cost.clip_model && ' 支持视频动态转绘。'}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => act('start', () => api.avatarStart(event.id))}
                className="btn-primary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 16px',
                  fontSize: '13px',
                  fontWeight: 600,
                  borderRadius: '8px',
                }}
              >
                {busyAction === 'start' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                开始绘制形象
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => act('cancel', () => api.avatarCancel(event.id))}
                className="btn-secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  fontSize: '13px',
                  borderRadius: '8px',
                }}
              >
                <X size={14} /> 暂不需要
              </button>
            </div>
          </div>
        )}

        {/* Stage 2 & 3: Drawing / Choose (2x2 Grid) */}
        {(stage === 'drawing' || stage === 'choose') && (
          <div style={{ padding: '14px 16px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '10px',
                marginBottom: '12px',
              }}
            >
              {event.candidates.map((imgUrl, idx) => {
                const cornerLabel = ['左上', '右上', '左下', '右下'][idx];
                const isSelected = event.chosen === idx;
                return (
                  <div
                    key={idx}
                    style={{
                      position: 'relative',
                      aspectRatio: '1/1',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      background: 'var(--om-surface-2, #f3f4f6)',
                      border: isSelected ? '2px solid var(--om-accent, #3b82f6)' : '1px solid var(--om-border, #e5e7eb)',
                      cursor: stage === 'choose' && imgUrl ? 'pointer' : 'default',
                      transition: 'all 0.15s ease',
                    }}
                    onClick={() => {
                      if (stage === 'choose' && imgUrl && busyAction === null) {
                        act(`choose-${idx}`, () => api.avatarChoose(event.id, idx));
                      }
                    }}
                  >
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt={`候选 ${idx + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          color: 'var(--om-muted, #9ca3af)',
                        }}
                      >
                        <Loader2 size={20} className="animate-spin" />
                        <span style={{ fontSize: '11px' }}>生成中...</span>
                      </div>
                    )}

                    {/* Corner Badge */}
                    <div
                      style={{
                        position: 'absolute',
                        top: '6px',
                        left: '6px',
                        background: 'rgba(0, 0, 0, 0.65)',
                        color: '#ffffff',
                        fontSize: '10.5px',
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: '6px',
                        backdropFilter: 'blur(4px)',
                      }}
                    >
                      #{idx + 1} {cornerLabel}
                    </div>

                    {/* Click overlay for choose */}
                    {stage === 'choose' && imgUrl && (
                      <div
                        className="avatar-card-hover-mask"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'rgba(59, 130, 246, 0.75)',
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: busyAction === `choose-${idx}` ? 1 : 0,
                          transition: 'opacity 0.15s ease',
                          fontSize: '12px',
                          fontWeight: 600,
                          gap: '4px',
                        }}
                      >
                        {busyAction === `choose-${idx}` ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <>
                            <Check size={16} /> 选用此款
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {stage === 'choose' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: 'var(--om-muted, #6b7280)' }}>
                  可在输入框中直接说「第2个」或「左上角」
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => act('regenerate', () => api.avatarStart(event.id))}
                    className="btn-secondary"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '5px 10px',
                      fontSize: '12px',
                      borderRadius: '6px',
                    }}
                  >
                    <RefreshCw size={12} className={busyAction === 'regenerate' ? 'animate-spin' : ''} />
                    再来一组
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => act('cancel', () => api.avatarCancel(event.id))}
                    className="btn-secondary"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '5px 8px',
                      fontSize: '12px',
                      borderRadius: '6px',
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stage 4: Posing */}
        {stage === 'posing' && (
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              {typeof event.chosen === 'number' && event.candidates[event.chosen] && (
                <img
                  src={event.candidates[event.chosen]!}
                  alt="选定候选"
                  style={{ width: '48px', height: '48px', borderRadius: '10px', objectFit: 'cover' }}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                  <Loader2 size={14} className="animate-spin text-accent" />
                  <span>正在渲染全套姿态 (工作、等待、喜悦、错误)...</span>
                </div>
                <div style={{ fontSize: '11.5px', color: 'var(--om-muted, #6b7280)', marginTop: '2px' }}>
                  保持人设面容与配色一致，自动赋予情绪特有道具
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Stage 5: Done */}
        {stage === 'done' && event.moods && (
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '6px', marginBottom: '12px' }}>
              {(['idle', 'working', 'waiting', 'happy', 'error'] as AvatarMood[]).map((m) => {
                const moodImg = event.moods?.[m];
                return (
                  <div key={m} style={{ flexShrink: 0, textAlign: 'center', width: '58px' }}>
                    <div
                      style={{
                        width: '56px',
                        height: '56px',
                        borderRadius: '10px',
                        overflow: 'hidden',
                        background: 'var(--om-surface-2, #f3f4f6)',
                        border: '1px solid var(--om-border, #e5e7eb)',
                      }}
                    >
                      {moodImg ? (
                        <img src={moodImg} alt={m} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          -
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: '10px', color: 'var(--om-muted, #6b7280)', display: 'block', marginTop: '3px' }}>
                      {MOOD_LABELS[m]}
                    </span>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Check size={14} /> 已作为当前 Bot 形象生效
              </span>
              {onOpenStudio && (
                <button
                  type="button"
                  onClick={onOpenStudio}
                  className="btn-secondary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 10px',
                    fontSize: '12px',
                    borderRadius: '6px',
                  }}
                >
                  <Eye size={12} /> 在工坊中预览
                </button>
              )}
            </div>
          </div>
        )}

        {/* Cancelled or Failed */}
        {(stage === 'cancelled' || stage === 'failed') && (
          <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12.5px', color: 'var(--om-muted, #6b7280)' }}>
              {event.message || (stage === 'cancelled' ? '形象创建已取消' : '生成失败，请重试')}
            </span>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => act('retry', () => api.avatarBegin({ description: event.description, style: event.style }))}
              className="btn-secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 10px',
                fontSize: '12px',
                borderRadius: '6px',
              }}
            >
              <RefreshCw size={12} /> 重新发起
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

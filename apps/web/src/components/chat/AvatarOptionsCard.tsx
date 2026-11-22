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
    <div className="avatar-options-card-wrap">
      <div className={`avatar-card-container ${isLive ? 'is-live' : ''}`}>
        {/* Header Bar */}
        <div className="avatar-card-header">
          <div className="avatar-card-icon-circle">
            <Sparkles size={16} />
          </div>
          <div className="avatar-card-header-info">
            <div className="avatar-card-stage-title">
              {stage === 'estimate' && `为 ${botName} 创作新虚拟形象`}
              {stage === 'drawing' && '正在生成 4 组候选方案...'}
              {stage === 'choose' && '挑选心仪形象：点击图片或输入序号'}
              {stage === 'posing' && '正在生成 5 种心情全套姿态...'}
              {stage === 'done' && '形象装配完成！已成功激活'}
              {stage === 'cancelled' && '已取消本次形象更换'}
              {stage === 'failed' && '形象生成中断'}
            </div>
            <div className="avatar-card-desc-title" title={event.description}>
              {event.description}
            </div>
          </div>
        </div>

        {/* Stage 1: Estimate */}
        {stage === 'estimate' && (
          <div className="avatar-card-body">
            <div className="avatar-card-estimate-desc">
              预计生成 {cost.pictures || 8} 张高保真切图（4 组多角度候选方案 + 4 种情绪动作姿态）。
              {cost.clip_model && ' 支持视频动态转绘。'}
            </div>
            <div className="avatar-card-btn-row">
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => act('start', () => api.avatarStart(event.id))}
                className="btn-primary avatar-card-btn-action"
              >
                {busyAction === 'start' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                开始绘制形象
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => act('cancel', () => api.avatarCancel(event.id))}
                className="btn-secondary avatar-card-btn-action"
              >
                <X size={14} /> 暂不需要
              </button>
            </div>
          </div>
        )}

        {/* Stage 2 & 3: Drawing / Choose (2x2 Grid) */}
        {(stage === 'drawing' || stage === 'choose') && (
          <div className="avatar-card-body">
            <div className="avatar-card-grid-2x2">
              {event.candidates.map((imgUrl, idx) => {
                const cornerLabel = ['左上', '右上', '左下', '右下'][idx];
                const isSelected = event.chosen === idx;
                const isBusyThis = busyAction === `choose-${idx}`;
                return (
                  <div
                    key={idx}
                    className={`avatar-card-candidate-cell ${isSelected ? 'is-selected' : ''}`}
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
                        className="avatar-card-candidate-img"
                      />
                    ) : (
                      <div className="avatar-card-candidate-empty">
                        <Loader2 size={20} className="animate-spin" />
                        <span className="font-size-11">生成中...</span>
                      </div>
                    )}

                    {/* Corner Badge */}
                    <div className="avatar-card-candidate-tag">
                      #{idx + 1} {cornerLabel}
                    </div>

                    {/* Hover mask for choose */}
                    {stage === 'choose' && imgUrl && (
                      <div className={`avatar-card-hover-mask ${isBusyThis ? 'is-active' : ''}`}>
                        {isBusyThis ? (
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
              <div className="avatar-card-bottom-bar">
                <span className="avatar-card-bottom-text">
                  可在输入框中直接说「第2个」或「左上角」
                </span>
                <div className="flex-center-gap-6">
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => act('regenerate', () => api.avatarStart(event.id))}
                    className="btn-secondary btn-sm"
                  >
                    <RefreshCw size={12} className={busyAction === 'regenerate' ? 'animate-spin' : ''} />
                    再来一组
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => act('cancel', () => api.avatarCancel(event.id))}
                    className="btn-secondary btn-sm"
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
          <div className="avatar-card-body">
            <div className="avatar-card-done-preview">
              {typeof event.chosen === 'number' && event.candidates[event.chosen] && (
                <img
                  src={event.candidates[event.chosen]!}
                  alt="选定候选"
                  className="avatar-card-done-avatar"
                />
              )}
              <div className="flex-1">
                <div className="avatar-card-done-name-line">
                  <Loader2 size={14} className="animate-spin text-accent" />
                  <span>正在渲染全套姿态 (工作、等待、喜悦、错误)...</span>
                </div>
                <div className="avatar-card-done-sub">
                  保持人设面容与配色一致，自动赋予情绪特有道具
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Stage 5: Done */}
        {stage === 'done' && event.moods && (
          <div className="avatar-card-body">
            <div className="avatar-card-moods-scroll">
              {(['idle', 'working', 'waiting', 'happy', 'error'] as AvatarMood[]).map((m) => {
                const moodImg = event.moods?.[m];
                return (
                  <div key={m} className="avatar-card-mood-item">
                    <div className="avatar-card-mood-box">
                      {moodImg ? (
                        <img src={moodImg} alt={m} className="avatar-card-candidate-img" />
                      ) : (
                        <div className="avatar-card-candidate-empty">
                          -
                        </div>
                      )}
                    </div>
                    <span className="avatar-card-mood-label">
                      {MOOD_LABELS[m]}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="avatar-card-bottom-bar">
              <span className="avatar-card-status-success">
                <Check size={14} /> 已作为当前 Bot 形象生效
              </span>
              {onOpenStudio && (
                <button
                  type="button"
                  onClick={onOpenStudio}
                  className="btn-secondary btn-sm"
                >
                  <Eye size={12} /> 在工坊中预览
                </button>
              )}
            </div>
          </div>
        )}

        {/* Cancelled or Failed */}
        {(stage === 'cancelled' || stage === 'failed') && (
          <div className="avatar-card-body avatar-card-bottom-bar">
            <span className="avatar-card-bottom-text">
              {event.message || (stage === 'cancelled' ? '形象创建已取消' : '生成失败，请重试')}
            </span>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => act('retry', () => api.avatarBegin({ description: event.description, style: event.style }))}
              className="btn-secondary btn-sm"
            >
              <RefreshCw size={12} /> 重新发起
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

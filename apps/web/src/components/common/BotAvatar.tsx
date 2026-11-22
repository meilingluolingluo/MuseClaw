import React, { useState, useEffect } from 'react';
import type { Bot, AvatarMood } from '../../types';

interface BotAvatarProps {
  bot?: Bot | null;
  size?: number;
  mood?: AvatarMood;
  motion?: string;
  still?: boolean;
  interactive?: boolean;
  onClick?: () => void;
  className?: string;
}

const noClipSet = new Set<string>();

export const BotAvatar: React.FC<BotAvatarProps> = ({
  bot,
  size = 36,
  mood = 'idle',
  motion = 'avatar-idle',
  still = false,
  interactive = true,
  onClick,
  className = '',
}) => {
  const [wiggle, setWiggle] = useState(false);
  const [, setClipFailCount] = useState(0);

  useEffect(() => {
    if (!wiggle) return;
    const timer = setTimeout(() => setWiggle(false), 900);
    return () => clearTimeout(timer);
  }, [wiggle]);

  const avatarVal = (bot?.avatar || 'haibara').trim();
  const isCustomFace = avatarVal.startsWith('face_') || avatarVal.startsWith('face-');
  const isPreset = ['haibara'].includes(avatarVal);
  const isDragon = avatarVal === 'dragon';
  const isImageUrl = avatarVal.startsWith('/') || avatarVal.startsWith('http') || avatarVal.startsWith('data:image/');

  const avatarType = bot?.avatarType || (
    isDragon ? 'dragon' :
    isCustomFace ? 'custom' :
    isPreset ? 'preset' :
    isImageUrl ? 'image' :
    'emoji'
  );

  const activeMood: AvatarMood = wiggle ? 'happy' : mood;
  const clipMood = activeMood === 'working' || activeMood === 'waiting' || activeMood === 'happy' ? activeMood : 'idle';

  let clipUrl: string | null = null;
  let stillUrl = '';

  if (avatarType === 'dragon') {
    stillUrl = `/avatars/dragon-${activeMood === 'error' ? 'error' : clipMood}.webp`;
    if (activeMood !== 'error') {
      clipUrl = `/avatars/dragon-${clipMood}.mp4`;
    }
  } else if (avatarType === 'custom') {
    stillUrl = `/avatars/custom/${avatarVal}/${activeMood}.webp`;
    const customClips = (bot as any)?.clips;
    if (activeMood !== 'error' && customClips && customClips[clipMood]) {
      clipUrl = customClips[clipMood];
    }
  } else if (avatarType === 'preset') {
    const presetId = avatarVal || 'haibara';
    stillUrl = `/avatars/presets/${presetId}/${activeMood === 'error' ? 'error' : activeMood}.webp`;
    const presetClips = (bot as any)?.clips;
    if (activeMood !== 'error' && presetClips && presetClips[clipMood]) {
      clipUrl = presetClips[clipMood];
    }
  } else if (avatarType === 'image') {
    stillUrl = avatarVal;
  }

  const canPlayClip = !still && size >= 36 && clipUrl && !noClipSet.has(clipUrl);

  const handleClick = (e: React.MouseEvent) => {
    if (interactive) {
      setWiggle(true);
    }
    onClick?.();
  };

  const motionClass = wiggle ? 'avatar-wiggle' : still ? '' : motion;

  let innerContent: React.ReactNode;

  if (canPlayClip && clipUrl) {
    innerContent = (
      <video
        key={clipUrl}
        src={clipUrl}
        poster={stillUrl}
        autoPlay
        loop
        muted
        playsInline
        disablePictureInPicture
        onError={() => {
          if (clipUrl) noClipSet.add(clipUrl);
          setClipFailCount((prev) => prev + 1);
        }}
        className="avatar-media"
      />
    );
  } else if (avatarType === 'dragon' || avatarType === 'custom' || avatarType === 'preset') {
    innerContent = (
      <img
        src={stillUrl}
        alt={bot?.name || avatarVal}
        draggable={false}
        className="avatar-media"
        onError={(e) => {
          const target = e.currentTarget as HTMLImageElement;
          if (avatarType === 'custom') {
            target.src = `/avatars/custom/${avatarVal}/idle.webp`;
          } else if (avatarType === 'preset') {
            target.src = '/avatars/presets/haibara/idle.webp';
          } else if (avatarType === 'dragon') {
            target.src = '/avatars/dragon-idle.webp';
          }
        }}
      />
    );
  } else if (avatarType === 'image') {
    innerContent = <img src={stillUrl} alt={bot?.name || ''} draggable={false} className="avatar-media" />;
  } else {
    const emoji = avatarVal.length <= 4 ? avatarVal : '🤖';
    const color = '#0064d4';
    const bgGradient = `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 65%, #ffffff))`;
    innerContent = (
      <span
        className="avatar-emoji-text"
        style={{
          background: bgGradient,
          fontSize: `${Math.round(size * 0.52)}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          borderRadius: '50%',
        }}
      >
        {emoji}
      </span>
    );
  }

  // 状态指示器颜色
  let statusBg = '';
  if (mood === 'working') statusBg = '#f59e0b';
  else if (mood === 'waiting') statusBg = '#3b82f6';
  else if (mood === 'error') statusBg = '#ef4444';

  const dotSize = Math.max(8, Math.round(size * 0.26));

  return (
    <div
      className={`nanomuse-avatar-wrap ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        cursor: interactive || onClick ? 'pointer' : 'default',
      }}
      onClick={handleClick}
      title={bot?.name ? `${bot.name} (${mood})` : undefined}
    >
      <div className={`nanomuse-avatar-circle ${motionClass}`}>
        {innerContent}
      </div>
      {statusBg && (
        <span
          style={{
            position: 'absolute',
            bottom: '-1px',
            right: '-1px',
            width: `${dotSize}px`,
            height: `${dotSize}px`,
            borderRadius: '50%',
            backgroundColor: statusBg,
            border: '2px solid var(--om-surface, #ffffff)',
            boxShadow: '0 0 4px rgba(0,0,0,0.2)',
            zIndex: 2,
          }}
        />
      )}
    </div>
  );
};

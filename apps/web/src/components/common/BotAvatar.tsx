import React from 'react';
import type { Bot } from '../../types';

interface BotAvatarProps {
  bot?: Bot | null;
  size?: number;
  mood?: 'idle' | 'working' | 'waiting' | 'happy' | 'error';
  motion?: string;
  still?: boolean;
  className?: string;
}

export const BotAvatar: React.FC<BotAvatarProps> = ({
  bot,
  size = 36,
  mood = 'idle',
  motion = 'avatar-idle',
  still = false,
  className = '',
}) => {
  const avatarVal = (bot?.avatar || '🤖').trim();
  const avatarType = bot?.avatarType || (
    avatarVal === 'dragon' ? 'dragon' :
    ['haibara', 'moss-courier', 'tide-tinker', 'dusk-moth', 'copper-acorn'].includes(avatarVal) ? 'preset' :
    avatarVal.startsWith('/') || avatarVal.startsWith('http') || avatarVal.startsWith('data:image/') ? 'image' :
    'emoji'
  );

  let innerContent: React.ReactNode;

  if (avatarType === 'dragon') {
    const clipMood = mood === 'working' || mood === 'waiting' || mood === 'happy' ? mood : 'idle';
    const posterUrl = `/avatars/dragon-${mood === 'error' ? 'error' : clipMood}.webp`;
    innerContent = <img src={posterUrl} alt="Dragon" draggable={false} className="avatar-media" />;
  } else if (avatarType === 'preset') {
    const presetId = avatarVal || 'haibara';
    const imgUrl = `/avatars/presets/${presetId}/${mood === 'error' ? 'error' : mood}.webp`;
    innerContent = (
      <img
        src={imgUrl}
        alt={presetId}
        draggable={false}
        className="avatar-media"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).src = '/avatars/presets/haibara/idle.webp';
        }}
      />
    );
  } else if (avatarType === 'image') {
    innerContent = <img src={avatarVal} alt={bot?.name || ''} draggable={false} className="avatar-media" />;
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

  const motionClass = still ? '' : motion;

  return (
    <div className={`nanomuse-avatar-wrap ${className}`} style={{ width: `${size}px`, height: `${size}px` }}>
      <div className={`nanomuse-avatar-circle ${motionClass}`}>
        {innerContent}
      </div>
    </div>
  );
};

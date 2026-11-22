import type {
  AvatarMood,
  AvatarStyle,
  AvatarStage,
  AvatarCostEstimate,
  AvatarSession,
  AvatarFaceMeta,
  AvatarPreset,
} from '@museclaw/protocol';

export type {
  AvatarMood,
  AvatarStyle,
  AvatarStage,
  AvatarCostEstimate,
  AvatarSession,
  AvatarFaceMeta,
  AvatarPreset,
};

export interface AvatarStudioView {
  available: boolean;
  unavailableMessage?: string;
  imageModel: string;
  videoModel?: string;
  cloud: boolean;
  currentSession: AvatarSession | null;
  activeFace: AvatarFaceMeta | null;
  presets: AvatarPreset[];
}

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TabType, User, Bot, Session, ModelsConfig } from '../types';
import { api, setOnUnauthorizedCallback } from '../services/api';
import { safeStorage } from '../utils/storage';
import type { ToastMessage } from '../components/common/Toast';

interface AppContextType {
  tab: TabType;
  setTab: (tab: TabType) => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  accentColor: string;
  setAccentColor: (color: string) => void;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: (open: boolean) => void;
  settingsInitialTab: string | null;
  setSettingsInitialTab: (tab: string | null) => void;
  openSettings: (tab?: string) => void;
  user: User | null;
  setUser: (u: User | null) => void;
  bots: Bot[];
  activeBotId: string | null;
  activeBot: Bot | null;
  selectBot: (botId: string) => void;
  sessions: Session[];
  activeSessionId: string | null;
  activeSession: Session | null;
  mainSession: Session | null;
  sideSessions: Session[];
  isMainChat: boolean;
  switchToMainChat: () => void;
  createNewSideChat: (title?: string) => Promise<Session | undefined>;
  setActiveBotId: (botId: string) => void;
  selectSession: (sessionId: string) => void;
  createNewSession: (silent?: boolean) => Promise<Session | undefined>;
  deleteSession: (sessionId: string) => Promise<void>;
  loadBots: () => Promise<void>;
  loadSessions: (botId: string, keepActiveId?: string) => Promise<void>;
  isDrawerCollapsed: boolean;
  setIsDrawerCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isMobileDrawerOpen: boolean;
  setIsMobileDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  modelsConfig: ModelsConfig | null;
  loadModelsConfig: () => Promise<void>;
  isModelModalOpen: boolean;
  setIsModelModalOpen: (open: boolean) => void;
  isImageModelModalOpen: boolean;
  setIsImageModelModalOpen: (open: boolean) => void;
  isAddMachineModalOpen: boolean;
  setIsAddMachineModalOpen: (open: boolean) => void;
  isAuthModalOpen: boolean;
  setIsAuthModalOpen: (open: boolean) => void;
  isBotModalOpen: boolean;
  setIsBotModalOpen: (open: boolean) => void;
  isAvatarStudioOpen: boolean;
  setIsAvatarStudioOpen: (open: boolean) => void;
  toasts: ToastMessage[];
  showToast: (msg: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
  dismissToast: (id: string) => void;
  isTainted: boolean;
  taintReasons: string[];
  setTainted: (tainted: boolean, reason?: string) => void;
  setApprovalMode: (mode: 'ASK' | 'AUTO_EDITS' | 'FULL') => Promise<void>;
  initError: string | null;
  retryInit: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Navigation
  const [tab, setTabState] = useState<TabType>(() => {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
    const valid: TabType[] = ['chat', 'feed', 'goals', 'routines', 'memory', 'skills', 'mcp', 'artifacts'];
    return (valid.includes(path as TabType) ? path : 'chat') as TabType;
  });

  const setTab = (newTab: TabType) => {
    setTabState(newTab);
    setIsMobileDrawerOpen(false);
    const targetPath = newTab === 'chat' ? '/' : `/${newTab}`;
    if (window.location.pathname !== targetPath) {
      window.history.pushState(null, '', targetPath);
    }
  };

  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
      const valid: TabType[] = ['chat', 'feed', 'goals', 'routines', 'memory', 'skills', 'mcp', 'artifacts'];
      setTabState((valid.includes(path as TabType) ? path : 'chat') as TabType);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Theme
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(() => {
    return (safeStorage.getItem('museclaw_theme') as any) || 'system';
  });

  const setTheme = (t: 'light' | 'dark' | 'system') => {
    setThemeState(t);
    safeStorage.setItem('museclaw_theme', t);
    const isDark =
      t === 'dark' || (t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    document.documentElement.dataset.themeSetting = t;
  };

  useEffect(() => {
    const isDark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    document.documentElement.dataset.themeSetting = theme;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e: MediaQueryListEvent) => {
      if (theme === 'system') {
        document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
      }
    };
    if (media.addEventListener) {
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    } else if ((media as any).addListener) {
      (media as any).addListener(listener);
      return () => (media as any).removeListener(listener);
    }
  }, [theme]);

  // 主题强调色与持久化
  const [accentColor, setAccentColorState] = useState<string>(() => {
    return safeStorage.getItem('museclaw_accent') || '#0064d4';
  });

  const setAccentColor = (color: string) => {
    setAccentColorState(color);
    safeStorage.setItem('museclaw_accent', color);
    document.documentElement.style.setProperty('--om-accent', color);
    document.documentElement.style.setProperty('--om-accent-soft', `${color}18`);
    document.documentElement.style.setProperty('--om-accent-soft-fg', color);
  };

  useEffect(() => {
    if (accentColor) {
      document.documentElement.style.setProperty('--om-accent', accentColor);
      document.documentElement.style.setProperty('--om-accent-soft', `${accentColor}18`);
      document.documentElement.style.setProperty('--om-accent-soft-fg', accentColor);
    }
  }, [accentColor]);

  // 系统设置弹窗状态控制
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | null>(null);
  const openSettings = useCallback((initialTab?: string) => {
    if (initialTab) {
      setSettingsInitialTab(initialTab);
    }
    setIsSettingsModalOpen(true);
  }, []);

  // User
  const [user, setUser] = useState<User | null>(null);

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    const id = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    const duration = type === 'error' || type === 'warning' ? 8000 : 3800;
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Global Online/Offline Listener
  useEffect(() => {
    const handleOnline = () => showToast('网络连接已恢复', 'info');
    const handleOffline = () => showToast('网络连接已断开，请检查网络设置', 'error');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [showToast]);

  // Global 401 Interceptor
  useEffect(() => {
    setOnUnauthorizedCallback(() => {
      setIsAuthModalOpen(true);
      showToast('登录已过期，请重新登录以保障数据归属隔离', 'warning');
    });
  }, [showToast]);

  // Bots & Sessions
  const [bots, setBots] = useState<Bot[]>([]);
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  const [isDrawerCollapsed, setIsDrawerCollapsed] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  // Modals & Panels
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [isImageModelModalOpen, setIsImageModelModalOpen] = useState(false);
  const [isAddMachineModalOpen, setIsAddMachineModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isBotModalOpen, setIsBotModalOpen] = useState(false);
  const [isAvatarStudioOpen, setIsAvatarStudioOpen] = useState(false);

  // Taint & Security
  const [isTainted, setIsTainted] = useState(false);
  const [taintReasons, setTaintReasons] = useState<string[]>([]);
  const [initError, setInitError] = useState<string | null>(null);

  const setTainted = (tainted: boolean, reason?: string) => {
    setIsTainted(tainted);
    if (reason) {
      setTaintReasons((prev) => [...prev, reason]);
    }
  };

  // Models Config
  const [modelsConfig, setModelsConfig] = useState<ModelsConfig | null>(null);

  const loadModelsConfig = useCallback(async () => {
    try {
      const cfg = await api.getModelsConfig();
      setModelsConfig(cfg);
    } catch (err) {
      console.error('Failed to load models config:', err);
    }
  }, []);

  const loadSessions = useCallback(
    async (botId: string, keepActiveId?: string) => {
      try {
        const canonicalId = `sess_${botId}_main`;
        const s = await api.getSessions(botId);
        let sessionList = Array.isArray(s) ? s : [];

        // 清洗重影：过滤掉非规范主聊 ID 但名为“主要聊天”且无消息的无效残留会话
        sessionList = sessionList.filter(
          (it) => it.id === canonicalId || it.title !== '主要聊天' || (it.messageCount && it.messageCount > 0)
        );

        // 确保单例主聊必然存在于会话列表首位并规范化属性
        const mainIdx = sessionList.findIndex((it) => it.id === canonicalId || it.kind === 'main');
        if (mainIdx === -1) {
          const initSess: Session = {
            id: canonicalId,
            botId,
            title: '主要聊天',
            kind: 'main',
            createdAt: Date.now(),
            messageCount: 0,
          };
          sessionList = [initSess, ...sessionList];
        } else {
          sessionList[mainIdx] = {
            ...sessionList[mainIdx],
            id: canonicalId,
            kind: 'main',
            title: '主要聊天',
          };
        }

        // 确保除主聊外所有会话的 kind 均为 side，且标题不与主聊冲突
        sessionList = sessionList.map((it) => {
          if (it.id === canonicalId) return it;
          return {
            ...it,
            kind: 'side',
            title: it.title === '主要聊天' ? '历史旁聊' : it.title,
          };
        });

        setSessions(sessionList);

        const currentActive = activeSessionIdRef.current;
        if (keepActiveId && sessionList.some((it) => it.id === keepActiveId)) {
          setActiveSessionId(keepActiveId);
        } else if (!currentActive || !sessionList.some((it) => it.id === currentActive)) {
          setActiveSessionId(canonicalId);
        }
      } catch (err) {
        console.error('Failed to load sessions:', err);
      }
    },
    []
  );

  const canonicalMainId = useMemo(() => {
    return activeBotId ? `sess_${activeBotId}_main` : null;
  }, [activeBotId]);

  const mainSession = useMemo(() => {
    if (!activeBotId || !canonicalMainId) return null;
    return (
      sessions.find((s) => s.id === canonicalMainId) ||
      sessions.find((s) => s.botId === activeBotId && s.kind === 'main') ||
      null
    );
  }, [sessions, activeBotId, canonicalMainId]);

  const sideSessions = useMemo(() => {
    if (!activeBotId || !canonicalMainId) return [];
    return sessions.filter(
      (s) =>
        s.botId === activeBotId &&
        s.id !== canonicalMainId &&
        !s.id.endsWith('_main') &&
        s.id !== 'main' &&
        s.kind !== 'main' &&
        s.title !== '主要聊天'
    );
  }, [sessions, activeBotId, canonicalMainId]);

  const isMainChat = Boolean(
    activeSessionId &&
      activeBotId &&
      (activeSessionId === canonicalMainId ||
        activeSessionId === mainSession?.id ||
        activeSessionId.endsWith('_main') ||
        activeSessionId === 'main' ||
        sessions.find((s) => s.id === activeSessionId)?.kind === 'main')
  );

  const switchToMainChat = useCallback(() => {
    if (!activeBotId) return;
    const targetId = canonicalMainId || `sess_${activeBotId}_main`;
    setActiveSessionId(targetId);

    // 确保 sessions 列表中包含该主聊单例，无需网络请求即可直接激活
    setSessions((prev) => {
      if (prev.some((s) => s.id === targetId || (s.botId === activeBotId && s.kind === 'main'))) {
        return prev;
      }
      const newMain: Session = {
        id: targetId,
        botId: activeBotId,
        title: '主要聊天',
        kind: 'main',
        createdAt: Date.now(),
        messageCount: 0,
      };
      return [newMain, ...prev];
    });
  }, [activeBotId, canonicalMainId]);

  const createNewSideChat = useCallback(
    async (title = '新旁聊'): Promise<Session | undefined> => {
      if (!activeBotId) return undefined;
      // 避免重复创建多个无消息的空旁聊
      const currentActiveId = activeSessionIdRef.current;
      const currentSession = sessions.find((s) => s.id === currentActiveId);
      if (
        currentSession &&
        currentSession.kind === 'side' &&
        (!currentSession.messageCount || currentSession.messageCount === 0)
      ) {
        showToast('当前已处于空旁聊任务中', 'info');
        return currentSession;
      }
      try {
        const safeTitle = title && title !== '主要聊天' ? title : '新旁聊';
        const newSession = await api.createSession(activeBotId, safeTitle, 'side');
        if (!newSession) throw new Error('服务端未返回会话');
        setSessions((prev) => [newSession, ...prev.filter((s) => s.id !== newSession.id)]);
        setActiveSessionId(newSession.id);
        showToast('已开启新旁聊任务', 'success');
        return newSession;
      } catch (err: any) {
        showToast(`新建旁聊失败: ${err.message || '网络异常'}`, 'error');
        return undefined;
      }
    },
    [activeBotId, sessions, showToast]
  );

  const selectBot = useCallback(
    (botId: string) => {
      setActiveBotId(botId);
      safeStorage.setItem('museclaw_active_bot', botId);
      loadSessions(botId);
    },
    [loadSessions]
  );

  const loadBots = useCallback(async () => {
    try {
      setInitError(null);
      const b = await api.getBots();
      const raw = Array.isArray(b) ? b : [];
      // 统一成前端使用的形状：以服务端 snake_case 为准，兼容历史 camelCase 字段
      const toApprovalMode = (value?: string) => {
        const v = String(value || 'ask').toLowerCase();
        if (v === 'full') return 'FULL';
        if (v === 'auto_edits' || v === 'auto') return 'AUTO_EDITS';
        return 'ASK';
      };
      const botList = raw.map((bot: any) => ({
        ...bot,
        systemPrompt: bot.system_prompt ?? bot.systemPrompt ?? '',
        approvalMode: toApprovalMode(bot.approval_level ?? bot.approvalMode),
        role: bot.role || '',
      }));
      setBots(botList);

      if (botList.length > 0) {
        const saved = safeStorage.getItem('museclaw_active_bot');
        const match = botList.find((bot) => bot.id === saved);
        const initial = match ? match.id : botList[0].id;
        setActiveBotId(initial);
        loadSessions(initial);
      }
    } catch (err: any) {
      console.error('Failed to load bots:', err);
      setInitError(err.message || '网关服务未就绪或未构建');
    }
  }, [loadSessions]);

  const selectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  const createNewSession = useCallback(
    async (silent = false): Promise<Session | undefined> => {
      if (!activeBotId) return undefined;
      const currentActiveId = activeSessionIdRef.current;
      const currentSession = sessions.find((s) => s.id === currentActiveId);
      if (currentSession && (!currentSession.messageCount || currentSession.messageCount === 0)) {
        if (!silent) showToast('当前已处于新建会话', 'info');
        return currentSession;
      }
      try {
        const newSession = await api.createSession(activeBotId, '新任务对话', 'side');
        if (!newSession) throw new Error('服务端未返回会话');
        setSessions((prev) => [newSession, ...prev.filter((s) => s.id !== newSession.id)]);
        setActiveSessionId(newSession.id);
        if (!silent) showToast('已新建会话', 'success');
        return newSession;
      } catch (err: any) {
        if (!silent) showToast(`新建会话失败: ${err.message || '网络异常'}`, 'error');
        return undefined;
      }
    },
    [activeBotId, sessions, showToast]
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        const target = sessions.find((s) => s.id === sessionId);
        const isTargetMain = Boolean(
          target && (target.kind === 'main' || target.id.endsWith('_main') || target.id === 'main')
        );

        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error(res.status === 401 ? '登录已过期，请重新登录' : `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => ({}));

        if (isTargetMain || data.cleared) {
          // 主聊为常驻核心会话，保留会话骨架，清空消息计数
          setSessions((prev) =>
            prev.map((s) => (s.id === sessionId ? { ...s, messageCount: 0 } : s))
          );
          showToast('主聊为常驻核心会话，已重置清空历史记录', 'info');
        } else {
          // 旁聊正常物理移除
          setSessions((prev) => prev.filter((s) => s.id !== sessionId));
          if (activeSessionId === sessionId) {
            // 切回当前 Bot 的主聊
            if (mainSession && mainSession.id !== sessionId) {
              setActiveSessionId(mainSession.id);
            } else {
              const remaining = sessions.filter((s) => s.id !== sessionId);
              if (remaining.length > 0) {
                setActiveSessionId(remaining[0].id);
              } else {
                switchToMainChat();
              }
            }
          }
          showToast('旁聊已删除', 'success');
        }
      } catch (err: any) {
        showToast(`删除会话失败: ${err.message}`, 'error');
      }
    },
    [activeSessionId, sessions, mainSession, switchToMainChat, showToast]
  );

  const setApprovalMode = useCallback(
    async (mode: 'ASK' | 'AUTO_EDITS' | 'FULL') => {
      if (!activeBotId) return;
      const bot = bots.find((b) => b.id === activeBotId);
      if (!bot) return;

      const current = (bot.approvalMode || 'ASK').toUpperCase() as 'ASK' | 'AUTO_EDITS' | 'FULL';
      if (current === mode) return;

      const labels: Record<'ASK' | 'AUTO_EDITS' | 'FULL', string> = {
        ASK: '逐项确认',
        AUTO_EDITS: '自动编辑',
        FULL: '允许完全访问',
      };

      const prevBots = bots;
      setBots((prev) => prev.map((b) => (b.id === activeBotId ? { ...b, approvalMode: mode } : b)));

      try {
        await api.updateBot(activeBotId, { approvalMode: mode });
        showToast(`已切换为${labels[mode]}`, 'info');
      } catch (err: any) {
        setBots(prevBots);
        showToast(`更新门禁模式失败: ${err.message}`, 'error');
      }
    },
    [activeBotId, bots, showToast]
  );

  // Initial load
  useEffect(() => {
    api
      .getMe()
      .then((res) => {
        if (res.user) {
          setUser(res.user);
        } else {
          // 未登录主动弹框引导
          setIsAuthModalOpen(true);
        }
      })
      .catch(() => {
        setIsAuthModalOpen(true);
      });

    loadBots();
    loadModelsConfig();
  }, [loadBots, loadModelsConfig]);

  const retryInit = useCallback(() => {
    loadBots();
    loadModelsConfig();
  }, [loadBots, loadModelsConfig]);

  const activeBot = bots.find((b) => b.id === activeBotId) || null;
  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  return (
    <AppContext.Provider
      value={{
        tab,
        setTab,
        setActiveBotId,
        theme,
        setTheme,
        accentColor,
        setAccentColor,
        isSettingsModalOpen,
        setIsSettingsModalOpen,
        settingsInitialTab,
        setSettingsInitialTab,
        openSettings,
        user,
        setUser,
        bots,
        activeBotId,
        activeBot,
        selectBot,
        sessions,
        activeSessionId,
        activeSession,
        mainSession,
        sideSessions,
        isMainChat,
        switchToMainChat,
        createNewSideChat,
        selectSession,
        createNewSession,
        deleteSession,
        loadBots,
        loadSessions,
        isDrawerCollapsed,
        setIsDrawerCollapsed,
        isMobileDrawerOpen,
        setIsMobileDrawerOpen,
        modelsConfig,
        loadModelsConfig,
        isModelModalOpen,
        setIsModelModalOpen,
        isImageModelModalOpen,
        setIsImageModelModalOpen,
        isAddMachineModalOpen,
        setIsAddMachineModalOpen,
        isAuthModalOpen,
        setIsAuthModalOpen,
        isBotModalOpen,
        setIsBotModalOpen,
        isAvatarStudioOpen,
        setIsAvatarStudioOpen,
        toasts,
        showToast,
        dismissToast,
        isTainted,
        taintReasons,
        setTainted,
        setApprovalMode,
        initError,
        retryInit,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextType {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

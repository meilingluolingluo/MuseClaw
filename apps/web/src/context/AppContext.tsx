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
  isAddMachineModalOpen: boolean;
  setIsAddMachineModalOpen: (open: boolean) => void;
  isAuthModalOpen: boolean;
  setIsAuthModalOpen: (open: boolean) => void;
  isBotModalOpen: boolean;
  setIsBotModalOpen: (open: boolean) => void;
  isAuditDrawerOpen: boolean;
  setIsAuditDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  focusApprovalId: string | null;
  setFocusApprovalId: (id: string | null) => void;
  toasts: ToastMessage[];
  showToast: (msg: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
  dismissToast: (id: string) => void;
  isTainted: boolean;
  taintReasons: string[];
  setTainted: (tainted: boolean, reason?: string) => void;
  cycleApprovalMode: () => Promise<void>;
  initError: string | null;
  retryInit: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Navigation
  const [tab, setTabState] = useState<TabType>(() => {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
    const valid: TabType[] = ['chat', 'feed', 'goals', 'routines', 'memory', 'skills', 'audit', 'artifacts'];
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
      const valid: TabType[] = ['chat', 'feed', 'goals', 'routines', 'memory', 'skills', 'audit', 'artifacts'];
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
  const [isAddMachineModalOpen, setIsAddMachineModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isBotModalOpen, setIsBotModalOpen] = useState(false);
  const [isAuditDrawerOpen, setIsAuditDrawerOpen] = useState(false);
  const [focusApprovalId, setFocusApprovalId] = useState<string | null>(null);

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
        const s = await api.getSessions(botId);
        const sessionList = Array.isArray(s) ? s : [];
        if (sessionList.length > 0) {
          setSessions(sessionList);
          const currentActive = activeSessionIdRef.current;
          if (keepActiveId && sessionList.some((it) => it.id === keepActiveId)) {
            setActiveSessionId(keepActiveId);
          } else if (!currentActive || !sessionList.some((it) => it.id === currentActive)) {
            // 优先默认激活常驻主聊 (kind === 'main' 或以 _main 结尾)
            const mainSess = sessionList.find((it) => it.kind === 'main' || it.id.endsWith('_main'));
            setActiveSessionId(mainSess ? mainSess.id : sessionList[0].id);
          }
        } else {
          // 当前 Bot 没有任何会话记录：以常驻主聊作为基座会话
          const defaultSessionId = `sess_${botId}_main`;
          const initSess: Session = {
            id: defaultSessionId,
            botId,
            title: '主要聊天',
            kind: 'main',
            createdAt: Date.now(),
            messageCount: 0,
          };
          setSessions([initSess]);
          setActiveSessionId(defaultSessionId);
        }
      } catch (err) {
        console.error('Failed to load sessions:', err);
      }
    },
    []
  );

  const mainSession = useMemo(() => {
    if (!activeBotId) return null;
    return (
      sessions.find(
        (s) =>
          s.botId === activeBotId &&
          (s.kind === 'main' || s.id.endsWith('_main') || s.id === 'main')
      ) || null
    );
  }, [sessions, activeBotId]);

  const sideSessions = useMemo(() => {
    if (!activeBotId) return [];
    return sessions.filter(
      (s) =>
        s.botId === activeBotId &&
        s.kind !== 'main' &&
        !s.id.endsWith('_main') &&
        s.id !== 'main'
    );
  }, [sessions, activeBotId]);

  const isMainChat = Boolean(
    activeSessionId &&
      (activeSessionId === mainSession?.id ||
        activeSessionId.endsWith('_main') ||
        activeSessionId === 'main' ||
        sessions.find((s) => s.id === activeSessionId)?.kind === 'main')
  );

  const switchToMainChat = useCallback(() => {
    if (mainSession) {
      setActiveSessionId(mainSession.id);
    } else if (activeBotId) {
      api
        .createSession(activeBotId, '主要聊天', 'main')
        .then((ms) => {
          setSessions((prev) => [ms, ...prev.filter((s) => s.id !== ms.id)]);
          setActiveSessionId(ms.id);
        })
        .catch(() => {
          setActiveSessionId(`sess_${activeBotId}_main`);
        });
    }
  }, [mainSession, activeBotId]);

  const createNewSideChat = useCallback(
    async (title = '新旁聊'): Promise<Session | undefined> => {
      if (!activeBotId) return undefined;
      try {
        const newSession = await api.createSession(activeBotId, title, 'side');
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
    [activeBotId, showToast]
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

  const cycleApprovalMode = useCallback(async () => {
    if (!activeBotId) return;
    const bot = bots.find((b) => b.id === activeBotId);
    if (!bot) return;

    const modes: Array<'ASK' | 'AUTO_EDITS' | 'FULL'> = ['ASK', 'AUTO_EDITS', 'FULL'];
    const current = (bot.approvalMode || 'ASK').toUpperCase() as 'ASK' | 'AUTO_EDITS' | 'FULL';
    const nextIdx = (modes.indexOf(current) + 1) % modes.length;
    const next = modes[nextIdx];

    // 乐观更新前暂存 prev，以便失败时回滚
    const prevBots = bots;
    setBots((prev) => prev.map((b) => (b.id === activeBotId ? { ...b, approvalMode: next } : b)));

    try {
      await api.updateBot(activeBotId, { approvalMode: next });
      showToast(`门禁审批模式已切换为 ${next}`, 'info');
    } catch (err: any) {
      setBots(prevBots);
      showToast(`更新门禁模式失败: ${err.message}`, 'error');
    }
  }, [activeBotId, bots, showToast]);

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
        isAddMachineModalOpen,
        setIsAddMachineModalOpen,
        isAuthModalOpen,
        setIsAuthModalOpen,
        isBotModalOpen,
        setIsBotModalOpen,
        isAuditDrawerOpen,
        setIsAuditDrawerOpen,
        focusApprovalId,
        setFocusApprovalId,
        toasts,
        showToast,
        dismissToast,
        isTainted,
        taintReasons,
        setTainted,
        cycleApprovalMode,
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

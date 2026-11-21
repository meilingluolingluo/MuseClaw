import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { TabType, User, Bot, Session, ModelsConfig } from '../types';
import { api } from '../services/api';
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
  selectSession: (sessionId: string) => void;
  createNewSession: (silent?: boolean) => Promise<Session | undefined>;
  deleteSession: (sessionId: string) => Promise<void>;
  loadBots: () => Promise<void>;
  loadSessions: (botId: string) => Promise<void>;
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
  toasts: ToastMessage[];
  showToast: (msg: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
  dismissToast: (id: string) => void;
  isTainted: boolean;
  taintReasons: string[];
  setTainted: (tainted: boolean, reason?: string) => void;
  cycleApprovalMode: () => Promise<void>;
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
      if (path === 'audit') {
        setIsAuditDrawerOpen(true);
        setTabState('chat');
        return;
      }
      const valid: TabType[] = ['chat', 'feed', 'goals', 'routines', 'memory', 'skills', 'artifacts'];
      setTabState((valid.includes(path as TabType) ? path : 'chat') as TabType);
    };
    window.addEventListener('popstate', onPopState);

    // 如果初始从 /audit 进入，自动展开对话并拉起审计抽屉
    const initialPath = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
    if (initialPath === 'audit') {
      setIsAuditDrawerOpen(true);
      setTabState('chat');
    }

    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Theme
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(() => {
    return (localStorage.getItem('museclaw_theme') as any) || 'system';
  });

  const setTheme = (t: 'light' | 'dark' | 'system') => {
    setThemeState(t);
    localStorage.setItem('museclaw_theme', t);
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
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [theme]);

  // User
  const [user, setUser] = useState<User | null>(null);

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    const id = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Bots & Sessions
  const [bots, setBots] = useState<Bot[]>([]);
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isDrawerCollapsed, setIsDrawerCollapsed] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  // Modals & Panels
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [isAddMachineModalOpen, setIsAddMachineModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isBotModalOpen, setIsBotModalOpen] = useState(false);
  const [isAuditDrawerOpen, setIsAuditDrawerOpen] = useState(false);

  // Taint & Security
  const [isTainted, setIsTainted] = useState(false);
  const [taintReasons, setTaintReasons] = useState<string[]>([]);

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

  const loadSessions = useCallback(async (botId: string) => {
    try {
      const s = await api.getSessions(botId, user?.username);
      const sessionList = Array.isArray(s) ? s : [];
      if (sessionList.length > 0) {
        setSessions(sessionList);
        setActiveSessionId(sessionList[0].id);
      } else {
        const initId = `sess_${botId}_${Date.now()}`;
        const initSess: Session = {
          id: initId,
          botId,
          title: '新任务对话',
          createdAt: Date.now(),
          messageCount: 0,
        };
        setSessions([initSess]);
        setActiveSessionId(initId);
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  }, [user?.username]);

  const selectBot = useCallback(
    (botId: string) => {
      setActiveBotId(botId);
      localStorage.setItem('museclaw_active_bot', botId);
      loadSessions(botId);
    },
    [loadSessions]
  );

  const loadBots = useCallback(async () => {
    try {
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
        const saved = localStorage.getItem('museclaw_active_bot');
        const match = botList.find((bot) => bot.id === saved);
        const initial = match ? match.id : botList[0].id;
        setActiveBotId(initial);
        loadSessions(initial);
      }
    } catch (err) {
      console.error('Failed to load bots:', err);
    }
  }, [loadSessions]);

  const selectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
  }, []);

  const createNewSession = useCallback(async (silent = false): Promise<Session | undefined> => {
    if (!activeBotId) return undefined;
    const fallbackId = `sess_${activeBotId}_${Date.now()}`;
    const draftSession: Session = {
      id: fallbackId,
      botId: activeBotId,
      title: '新任务对话',
      createdAt: Date.now(),
      messageCount: 0,
    };
    try {
      const newSession = await api.createSession(activeBotId, '新任务对话', user?.username);
      const sess = newSession || draftSession;
      setSessions((prev) => [sess, ...prev.filter((s) => s.id !== sess.id)]);
      setActiveSessionId(sess.id);
      if (!silent) showToast('已新建会话', 'success');
      return sess;
    } catch {
      setSessions((prev) => [draftSession, ...prev.filter((s) => s.id !== draftSession.id)]);
      setActiveSessionId(draftSession.id);
      if (!silent) showToast('已新建会话', 'success');
      return draftSession;
    }
  }, [activeBotId, user?.username, showToast]);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE', credentials: 'include' });
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        if (activeSessionId === sessionId) {
          const remaining = sessions.filter((s) => s.id !== sessionId);
          if (remaining.length > 0) {
            setActiveSessionId(remaining[0].id);
          } else {
            createNewSession();
          }
        }
        showToast('会话已删除', 'success');
      } catch (err: any) {
        showToast(`删除会话失败: ${err.message}`, 'error');
      }
    },
    [activeSessionId, sessions, createNewSession, showToast]
  );

  const cycleApprovalMode = useCallback(async () => {
    if (!activeBotId) return;
    const bot = bots.find((b) => b.id === activeBotId);
    if (!bot) return;

    const modes: Array<'ASK' | 'AUTO_EDITS' | 'FULL'> = ['ASK', 'AUTO_EDITS', 'FULL'];
    const current = (bot.approvalMode || 'ASK').toUpperCase() as 'ASK' | 'AUTO_EDITS' | 'FULL';
    const nextIdx = (modes.indexOf(current) + 1) % modes.length;
    const next = modes[nextIdx];

    try {
      await api.updateBot(activeBotId, { approvalMode: next });
      setBots((prev) => prev.map((b) => (b.id === activeBotId ? { ...b, approvalMode: next } : b)));
      showToast(`门禁审批模式已切换为 ${next}`, 'info');
    } catch (err: any) {
      showToast(`更新门禁模式失败: ${err.message}`, 'error');
    }
  }, [activeBotId, bots, showToast]);

  // Initial load
  useEffect(() => {
    api
      .getMe()
      .then((res) => {
        if (res.user) setUser(res.user);
      })
      .catch(() => {});

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
        toasts,
        showToast,
        dismissToast,
        isTainted,
        taintReasons,
        setTainted,
        cycleApprovalMode,
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

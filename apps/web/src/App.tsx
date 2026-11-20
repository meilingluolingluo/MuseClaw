import React, { Suspense, lazy } from 'react';
import { useApp } from './context/AppContext';
import type { TabType } from './types';
import { NavRail } from './components/layout/NavRail';
import { SideDrawer } from './components/layout/SideDrawer';
import { TopBar } from './components/layout/TopBar';
import { ChatView } from './components/chat/ChatView';
import { ToastContainer } from './components/common/Toast';
import { AlertTriangle } from 'lucide-react';

// 首屏只加载对话，其余工作台按需拆包
const FeedView = lazy(() =>
  import('./components/feed/FeedView').then((m) => ({ default: m.FeedView }))
);
const GoalsView = lazy(() =>
  import('./components/goals/GoalsView').then((m) => ({ default: m.GoalsView }))
);
const RoutinesView = lazy(() =>
  import('./components/routines/RoutinesView').then((m) => ({ default: m.RoutinesView }))
);
const MemoryView = lazy(() =>
  import('./components/memory/MemoryView').then((m) => ({ default: m.MemoryView }))
);
const SkillsView = lazy(() =>
  import('./components/skills/SkillsView').then((m) => ({ default: m.SkillsView }))
);
const AuditView = lazy(() =>
  import('./components/audit/AuditView').then((m) => ({ default: m.AuditView }))
);
const ArtifactsView = lazy(() =>
  import('./components/artifacts/ArtifactsView').then((m) => ({ default: m.ArtifactsView }))
);

import { ModelSettingsModal } from './components/modals/ModelSettingsModal';
import { AddMachineModal } from './components/modals/AddMachineModal';
import { AuthModal } from './components/modals/AuthModal';
import { BotProfileModal } from './components/modals/BotProfileModal';

function ViewLoading() {
  return (
    <div className="view-loading" role="status" aria-live="polite">
      <div className="view-loading-bar" />
      <div className="view-loading-bar" />
      <div className="view-loading-bar" />
      <span className="sr-only">正在载入</span>
    </div>
  );
}

/** 单个视图崩掉时保住整个工作台，而不是白屏 */
class ViewBoundary extends React.Component<
  { children: React.ReactNode; tab: TabType },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { tab: TabType }) {
    if (prev.tab !== this.props.tab && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="view-crash" role="alert">
          <AlertTriangle size={22} />
          <h2>这个页面没能打开</h2>
          <p>{this.state.error.message || '渲染时出现异常。'}</p>
          <button type="button" onClick={() => this.setState({ error: null })}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const VIEWS: Record<Exclude<TabType, 'chat'>, React.LazyExoticComponent<React.FC>> = {
  feed: FeedView,
  goals: GoalsView,
  routines: RoutinesView,
  memory: MemoryView,
  skills: SkillsView,
  audit: AuditView,
  artifacts: ArtifactsView,
};

export const App: React.FC = () => {
  const { tab, toasts, dismissToast } = useApp();
  const ActiveView = tab === 'chat' ? null : VIEWS[tab];

  return (
    <div className="app-container">
      {/* 1. 最左侧导航栏 */}
      <NavRail />

      {/* 2. 二级抽屉 (Bots 与会话历史) */}
      <SideDrawer />

      {/* 3. 主舞台区域 */}
      <main className="main-stage">
        <TopBar />
        <ViewBoundary tab={tab}>
          <Suspense fallback={<ViewLoading />}>
            {tab === 'chat' ? <ChatView /> : ActiveView ? <ActiveView /> : null}
          </Suspense>
        </ViewBoundary>
      </main>

      {/* Modals & Toasts */}
      <ModelSettingsModal />
      <AddMachineModal />
      <AuthModal />
      <BotProfileModal />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

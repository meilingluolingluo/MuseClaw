import React, { Suspense, lazy, useEffect } from 'react';
import { useApp } from './context/AppContext';
import type { TabType } from './types';
import { NavRail } from './components/layout/NavRail';
import { SideDrawer } from './components/layout/SideDrawer';
import { TopBar } from './components/layout/TopBar';
import { ChatView } from './components/chat/ChatView';
import { ToastContainer } from './components/common/Toast';
import { AlertTriangle } from 'lucide-react';
import { copyToClipboard } from './utils/clipboard';

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
const ArtifactsView = lazy(() =>
  import('./components/artifacts/ArtifactsView').then((m) => ({ default: m.ArtifactsView }))
);

const ModelSettingsModal = lazy(() =>
  import('./components/modals/ModelSettingsModal').then((m) => ({ default: m.ModelSettingsModal }))
);
const ImageModelSettingsModal = lazy(() =>
  import('./components/modals/ImageModelSettingsModal').then((m) => ({ default: m.ImageModelSettingsModal }))
);
const AddMachineModal = lazy(() =>
  import('./components/modals/AddMachineModal').then((m) => ({ default: m.AddMachineModal }))
);
const AuthModal = lazy(() =>
  import('./components/modals/AuthModal').then((m) => ({ default: m.AuthModal }))
);
const BotProfileModal = lazy(() =>
  import('./components/modals/BotProfileModal').then((m) => ({ default: m.BotProfileModal }))
);
const AvatarStudioModal = lazy(() =>
  import('./components/modals/AvatarStudioModal').then((m) => ({ default: m.AvatarStudioModal }))
);
const SettingsModal = lazy(() =>
  import('./components/modals/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);

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
          <AlertTriangle size={24} className="view-crash-icon" />
          <h2>页面暂时无法显示</h2>
          <p>模块加载或视图组件渲染时遇到意外错误，已为您保护其它工作区正常运行。</p>
          <div className="view-crash-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => this.setState({ error: null })}
            >
              重新加载视图
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => window.location.reload()}
            >
              刷新页面
            </button>
          </div>
          <details className="view-crash-details">
            <summary className="view-crash-summary">查看技术诊断信息</summary>
            <pre className="view-crash-pre">
              {this.state.error.stack || this.state.error.message || '未知异常'}
            </pre>
          </details>
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
  artifacts: ArtifactsView,
};

export const App: React.FC = () => {
  const {
    tab,
    toasts,
    dismissToast,
    isAvatarStudioOpen,
    setIsAvatarStudioOpen,
    activeBot,
    loadBots,
    showToast,
  } = useApp();
  const ActiveView = tab === 'chat' ? null : VIEWS[tab];

  // 全局托管代码块复制按钮事件
  useEffect(() => {
    const handleCodeCopy = async (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest?.('.code-copy-btn, .btn-code-copy') as HTMLButtonElement | null;
      if (!btn) return;
      const code =
        btn.getAttribute('data-code') ||
        btn.closest('.code-block-wrapper')?.querySelector('pre code')?.textContent;
      if (!code) return;
      const ok = await copyToClipboard(code);
      if (ok) {
        const prevText = btn.textContent;
        btn.textContent = '已复制';
        btn.classList.add('copied');
        showToast('代码已复制到剪贴板', 'info');
        setTimeout(() => {
          btn.textContent = prevText || '复制';
          btn.classList.remove('copied');
        }, 2000);
      } else {
        showToast('复制失败，请手动选中文本复制', 'error');
      }
    };
    document.addEventListener('click', handleCodeCopy);
    return () => document.removeEventListener('click', handleCodeCopy);
  }, [showToast]);

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
            <div key={tab} className="stage-view-wrapper">
              {tab === 'chat' ? <ChatView /> : ActiveView ? <ActiveView /> : null}
            </div>
          </Suspense>
        </ViewBoundary>
      </main>

      {/* Modals & Toasts */}
      <Suspense fallback={null}>
        <ModelSettingsModal />
        <ImageModelSettingsModal />
        <AddMachineModal />
        <AuthModal />
        <BotProfileModal />
        <AvatarStudioModal
          isOpen={isAvatarStudioOpen}
          onClose={() => {
            setIsAvatarStudioOpen(false);
            loadBots();
          }}
          targetBot={activeBot}
          zIndex={2100}
        />
        <SettingsModal />
      </Suspense>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

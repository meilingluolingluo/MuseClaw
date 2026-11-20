import React from 'react';
import { useApp } from './context/AppContext';
import { NavRail } from './components/layout/NavRail';
import { SideDrawer } from './components/layout/SideDrawer';
import { TopBar } from './components/layout/TopBar';
import { ChatView } from './components/chat/ChatView';
import { FeedView } from './components/feed/FeedView';
import { GoalsView } from './components/goals/GoalsView';
import { RoutinesView } from './components/routines/RoutinesView';
import { MemoryView } from './components/memory/MemoryView';
import { SkillsView } from './components/skills/SkillsView';
import { AuditView } from './components/audit/AuditView';
import { ArtifactsView } from './components/artifacts/ArtifactsView';
import { ModelSettingsModal } from './components/modals/ModelSettingsModal';
import { AddMachineModal } from './components/modals/AddMachineModal';
import { AuthModal } from './components/modals/AuthModal';
import { BotProfileModal } from './components/modals/BotProfileModal';
import { ToastContainer } from './components/common/Toast';

export const App: React.FC = () => {
  const { tab, toasts, dismissToast } = useApp();

  return (
    <div className="app-container">
      {/* 1. 最左侧导航栏 */}
      <NavRail />

      {/* 2. 二级抽屉 (Bots 与会话历史) */}
      <SideDrawer />

      {/* 3. 主舞台区域 */}
      <main className="main-stage">
        <TopBar />

        {tab === 'chat' && <ChatView />}
        {tab === 'feed' && <FeedView />}
        {tab === 'goals' && <GoalsView />}
        {tab === 'routines' && <RoutinesView />}
        {tab === 'memory' && <MemoryView />}
        {tab === 'skills' && <SkillsView />}
        {tab === 'audit' && <AuditView />}
        {tab === 'artifacts' && <ArtifactsView />}
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

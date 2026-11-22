import React, { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { User as UserIcon, LogOut, AlertCircle } from 'lucide-react';
import { api } from '../../services/api';

export const AuthModal: React.FC = () => {
  const { isAuthModalOpen, setIsAuthModalOpen, user, setUser, showToast, loadBots } = useApp();
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');

  // Form states
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // 关闭弹窗时清掉密码，不留在内存和输入框里
  useEffect(() => {
    if (!isAuthModalOpen) {
      setPassword('');
      setConfirmPassword('');
      setErrorMsg('');
    }
  }, [isAuthModalOpen]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await api.login({ username: username.trim(), password });
      setUser(res.user);
      setIsAuthModalOpen(false);
      showToast(`欢迎回来，${res.user.displayName || res.user.username}！`, 'success');
      loadBots();
    } catch (err: any) {
      setErrorMsg(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (password !== confirmPassword) {
      setErrorMsg('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      const res = await api.register({
        username: username.trim(),
        displayName: displayName.trim() || undefined,
        password,
      });
      setUser(res.user);
      setIsAuthModalOpen(false);
      showToast('注册成功，已自动登录！', 'success');
      loadBots();
    } catch (err: any) {
      setErrorMsg(err.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
      setUser(null);
      setIsAuthModalOpen(false);
      showToast('已安全退出登录', 'info');
    } catch (err: any) {
      showToast(`退出失败: ${err.message}`, 'error');
    }
  };

  return (
    <Modal
      isOpen={isAuthModalOpen}
      onClose={() => setIsAuthModalOpen(false)}
      title={user ? '员工身份与账号配置' : activeTab === 'login' ? '账号登录' : '注册新账号'}
      icon={<UserIcon size={18} />}
      maxWidth="460px"
    >
      {user ? (
        <div className="auth-profile-container">
          <div className="auth-user-header">
            <div className="auth-user-avatar">
              {(user.displayName || user.username).slice(0, 1).toUpperCase()}
            </div>
            <div className="auth-user-info">
              <div className="auth-user-name-line">
                <span className="auth-user-display-name">{user.displayName || user.username}</span>
                <span className="pill-badge pill-blue">账号已就绪</span>
              </div>
              <div className="auth-user-username">
                用户名: <code>{user.username}</code>
              </div>
            </div>
          </div>

          <div className="auth-user-meta-list">
            <div className="auth-user-meta-row">
              <span className="auth-user-meta-label">数据沙箱隔离</span>
              <span className="auth-user-meta-val is-green">● 独立数据存储就绪</span>
            </div>
            <div className="auth-user-meta-row">
              <span className="auth-user-meta-label">计算节点接入 Token</span>
              <span className="auth-user-meta-val font-mono">{user.username}</span>
            </div>
          </div>

          <div className="modal-actions-bar modal-actions-right">
            <button type="button" className="btn-secondary" onClick={() => setIsAuthModalOpen(false)}>
              关闭
            </button>
            <button
              type="button"
              className="btn-danger auth-logout-btn"
              onClick={handleLogout}
            >
              <LogOut size={14} /> <span>退出登录</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="auth-form-container">
          <div className="auth-tabs auth-tabs-row" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'login'}
              onClick={() => { setActiveTab('login'); setErrorMsg(''); }}
              className={`auth-tab auth-tab-btn ${activeTab === 'login' ? 'is-active' : ''}`}
            >
              账号登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'register'}
              onClick={() => { setActiveTab('register'); setErrorMsg(''); }}
              className={`auth-tab auth-tab-btn ${activeTab === 'register' ? 'is-active' : ''}`}
            >
              注册新账号
            </button>
          </div>

          {errorMsg && (
            <div
              role="alert"
              aria-live="polite"
              className="auth-alert is-error auth-error-alert"
            >
              <AlertCircle size={15} className="flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {activeTab === 'login' ? (
            <form onSubmit={handleLogin} className="auth-form">
              <div className="auth-field">
                <label htmlFor="login-username" className="auth-label">用户名</label>
                <input
                  id="login-username"
                  name="username"
                  autoComplete="username"
                  type="text"
                  required
                  placeholder="请输入账号用户名"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="auth-input"
                />
              </div>
              <div className="auth-field">
                <label htmlFor="login-password" className="auth-label">密码</label>
                <input
                  id="login-password"
                  name="password"
                  autoComplete="current-password"
                  type="password"
                  required
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="auth-input"
                />
              </div>
              <button
                type="submit"
                className="btn-primary auth-submit-btn"
                disabled={loading}
              >
                {loading ? '正在登录...' : '立即登录'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="auth-form">
              <div className="auth-field">
                <label htmlFor="reg-username" className="auth-label">用户名</label>
                <input
                  id="reg-username"
                  name="username"
                  autoComplete="username"
                  type="text"
                  required
                  placeholder="2-32位字符"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="auth-input"
                />
              </div>
              <div className="auth-field">
                <label htmlFor="reg-display" className="auth-label">显示昵称 (选填)</label>
                <input
                  id="reg-display"
                  name="displayName"
                  autoComplete="nickname"
                  type="text"
                  placeholder="例如：开发助手小李"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="auth-input"
                />
              </div>
              <div className="auth-field">
                <label htmlFor="reg-password" className="auth-label">密码</label>
                <input
                  id="reg-password"
                  name="new-password"
                  autoComplete="new-password"
                  type="password"
                  required
                  minLength={6}
                  placeholder="至少 6 位密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="auth-input"
                />
              </div>
              <div className="auth-field">
                <label htmlFor="reg-confirm" className="auth-label">确认密码</label>
                <input
                  id="reg-confirm"
                  name="confirm-password"
                  autoComplete="new-password"
                  type="password"
                  required
                  minLength={6}
                  placeholder="再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="auth-input"
                />
              </div>
              <button
                type="submit"
                className="btn-primary auth-submit-btn"
                disabled={loading}
              >
                {loading ? '正在注册...' : '立即注册并登录'}
              </button>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
};

import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { useApp } from '../../context/AppContext';
import { User as UserIcon, LogOut } from 'lucide-react';
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
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid var(--om-border)' }}>
            <div
              style={{
                width: '52px',
                height: '52px',
                borderRadius: '50%',
                background: 'var(--om-accent)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
                fontWeight: 650,
              }}
            >
              {(user.displayName || user.username).slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 650, color: 'var(--om-fg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>{user.displayName || user.username}</span>
                <span className="pill-badge pill-blue" style={{ fontSize: '11px' }}>账号已就绪</span>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--om-muted)', marginTop: '3px' }}>
                用户名: <code>{user.username}</code>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--om-muted)' }}>数据沙箱隔离</span>
              <span style={{ color: 'var(--accent-green)', fontWeight: 550 }}>● 独立数据存储就绪</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--om-muted)' }}>计算节点接入 Token</span>
              <span style={{ fontFamily: 'monospace' }}>{user.username}</span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button type="button" className="btn-secondary" onClick={() => setIsAuthModalOpen(false)}>
              关闭
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={handleLogout}
              style={{ padding: '6px 14px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <LogOut size={14} /> 退出登录
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--om-border)', paddingBottom: '10px', marginBottom: '18px' }}>
            <button
              type="button"
              onClick={() => { setActiveTab('login'); setErrorMsg(''); }}
              style={{
                padding: '6px 18px',
                borderRadius: '20px',
                fontWeight: 600,
                fontSize: '13px',
                border: 'none',
                cursor: 'pointer',
                background: activeTab === 'login' ? 'var(--om-accent)' : 'transparent',
                color: activeTab === 'login' ? '#fff' : 'var(--om-muted)',
              }}
            >
              账号登录
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('register'); setErrorMsg(''); }}
              style={{
                padding: '6px 18px',
                borderRadius: '20px',
                fontWeight: 600,
                fontSize: '13px',
                border: 'none',
                cursor: 'pointer',
                background: activeTab === 'register' ? 'var(--om-accent)' : 'transparent',
                color: activeTab === 'register' ? '#fff' : 'var(--om-muted)',
              }}
            >
              注册新账号
            </button>
          </div>

          {errorMsg && (
            <div style={{ padding: '8px 12px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-red)', fontSize: '12.5px', marginBottom: '14px' }}>
              {errorMsg}
            </div>
          )}

          {activeTab === 'login' ? (
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>用户名</label>
                <input
                  type="text"
                  required
                  placeholder="请输入账号用户名"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--om-border)', background: 'var(--om-surface-2)', color: 'var(--om-fg)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>密码</label>
                <input
                  type="password"
                  required
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--om-border)', background: 'var(--om-surface-2)', color: 'var(--om-fg)' }}
                />
              </div>
              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
                style={{ marginTop: '8px', padding: '11px', borderRadius: '8px', fontWeight: 600 }}
              >
                {loading ? '正在登录...' : '立即登录'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>用户名</label>
                <input
                  type="text"
                  required
                  placeholder="2-32位字符"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--om-border)', background: 'var(--om-surface-2)', color: 'var(--om-fg)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>显示昵称 (选填)</label>
                <input
                  type="text"
                  placeholder="例如：开发助手小李"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--om-border)', background: 'var(--om-surface-2)', color: 'var(--om-fg)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>密码</label>
                <input
                  type="password"
                  required
                  placeholder="至少 6 位密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--om-border)', background: 'var(--om-surface-2)', color: 'var(--om-fg)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>确认密码</label>
                <input
                  type="password"
                  required
                  placeholder="再次输入密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--om-border)', background: 'var(--om-surface-2)', color: 'var(--om-fg)' }}
                />
              </div>
              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
                style={{ marginTop: '8px', padding: '11px', borderRadius: '8px', fontWeight: 600 }}
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

import type { InboundMessage, RouteResult, AgentProfile } from '@museclaw/protocol';
import type { BotRegistry } from './registry.ts';
import type { SessionStore } from './session-store.ts';

export class SessionRouter {
  private registry: BotRegistry;
  private sessionStore: SessionStore;

  constructor(registry: BotRegistry, sessionStore: SessionStore) {
    this.registry = registry;
    this.sessionStore = sessionStore;
  }

  /**
   * 解析消息中的 @Mention (支持 @Name 与 @"Name With Space")
   */
  public parseMention(text: string): { mentionName?: string; cleanText: string } {
    const mentionRegex = /@"([^"]+)"|@([a-zA-Z0-9_\u4e00-\u9fa5\-]+)/;
    const match = text.match(mentionRegex);
    if (!match) {
      return { cleanText: text };
    }

    const mentionName = (match[1] || match[2]).trim();
    // 移除 @Mention 标记，保留核心问题
    const cleanText = text.replace(match[0], '').trim();
    return { mentionName, cleanText };
  }

  /**
   * 严格按照多 Bot 路由规则执行路由
   */
  public route(inbound: InboundMessage): RouteResult {
    const rawText = inbound.text || '';
    const userId = inbound.user_id || 'user_web';
    const { mentionName } = this.parseMention(rawText);

    // 规则 1: 若文本含 @Mention，按 name 在「已启用」Bot 中解析；失败则明确报错
    if (mentionName) {
      const targetBot = this.registry.findByName(mentionName);
      if (!targetBot) {
        throw new Error(`未找到名为 "${mentionName}" 的已启用 Bot`);
      }

      let targetSessionId: string;
      if (inbound.session_id) {
        const existingSession = this.sessionStore.get(inbound.session_id, userId);
        if (existingSession && existingSession.bot_id === targetBot.id) {
          // 同一 Bot，沿用当前会话
          targetSessionId = existingSession.id;
        } else {
          // 切到新 Bot 或无该会话 -> 为新 Bot 创建独立新 session，不修改旧 session
          targetSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          this.sessionStore.create(targetSessionId, targetBot.id, '新会话', userId);
        }
      } else {
        targetSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        this.sessionStore.create(targetSessionId, targetBot.id, '新会话', userId);
      }

      return {
        bot: targetBot,
        session_id: targetSessionId,
        mention_name: mentionName
      };
    }

    // 规则 2: 否则若带 session_id：加载会话，使用会话上的 bot_id；若同时带了与会话不一致的 bot_id，则切到新 session
    if (inbound.session_id) {
      const existingSession = this.sessionStore.get(inbound.session_id, userId);
      if (existingSession) {
        // 如果同时指定了与现有 session 不一致的 bot_id，视为切换 Bot
        if (inbound.bot_id && inbound.bot_id !== existingSession.bot_id) {
          const targetBot = this.registry.get(inbound.bot_id);
          if (!targetBot || !targetBot.enabled) {
            throw new Error(`目标 Bot [${inbound.bot_id}] 不存在或已禁用`);
          }
          const newSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          this.sessionStore.create(newSessionId, targetBot.id, '新会话', userId);
          return { bot: targetBot, session_id: newSessionId };
        }

        const currentBot = this.registry.get(existingSession.bot_id);
        if (!currentBot || !currentBot.enabled) {
          throw new Error(`会话绑定的 Bot [${existingSession.bot_id}] 不存在或已禁用`);
        }
        return { bot: currentBot, session_id: existingSession.id };
      }

      // session_id 在库中尚不存在：如果指定了有效 bot_id 则创建，否则 fallback 到协调者
      let bot: AgentProfile | undefined;
      if (inbound.bot_id) {
        bot = this.registry.get(inbound.bot_id);
        if (!bot || !bot.enabled) {
          throw new Error(`指定的 Bot [${inbound.bot_id}] 不存在或已禁用`);
        }
      } else {
        bot = this.getFallbackBot();
      }

      this.sessionStore.create(inbound.session_id, bot.id, '新会话', userId);
      return { bot, session_id: inbound.session_id };
    }

    // 规则 3: 否则若带 bot_id：使用该 Bot（须 enabled）
    if (inbound.bot_id) {
      const bot = this.registry.get(inbound.bot_id);
      if (!bot || !bot.enabled) {
        throw new Error(`指定的 Bot [${inbound.bot_id}] 不存在或已禁用`);
      }
      const newSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      this.sessionStore.create(newSessionId, bot.id, '新会话', userId);
      return { bot, session_id: newSessionId };
    }

    // 规则 4: 否则：使用 is_coordinator=true 的 Bot；若无则任意一个 enabled；若无 Bot 则 ensureDefault
    const bot = this.getFallbackBot();
    const newSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.sessionStore.create(newSessionId, bot.id, '新会话', userId);
    return { bot, session_id: newSessionId };
  }

  private getFallbackBot(): AgentProfile {
    // 1. is_coordinator=true 的 Bot
    const coordinator = this.registry.getCoordinator();
    if (coordinator && coordinator.enabled) {
      return coordinator;
    }

    // 2. 任意一个 enabled 的 Bot
    const enabledBots = this.registry.list().filter((b) => b.enabled);
    if (enabledBots.length > 0) {
      return enabledBots[0];
    }

    // 3. 若无 Bot 则 ensureDefault
    return this.registry.ensureDefault();
  }
}

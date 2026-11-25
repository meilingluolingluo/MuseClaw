import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BotMemoryManager,
  MemoryPipeline,
  FeedStore,
  ProactiveBriefEngine,
  SessionStore
} from '../apps/gateway/bots/index.ts';
import { GoalStore } from '../apps/gateway/goals/store.ts';
import type { LLMCaller } from '../packages/sandbox-core/src/loop.ts';

async function testCognitiveMemorySystem() {
  console.log('🧪 开始自检 MuseClaw 认知记忆、Feed 2.0 与主动智能中枢...');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'museclaw-cogmem-'));

  try {
    const usersDir = path.join(tempRoot, 'users');
    const botMemory = new BotMemoryManager(usersDir);
    const pipeline = new MemoryPipeline(botMemory);
    const feedStore = new FeedStore(usersDir);
    const sessionStore = new SessionStore(usersDir);
    const goalStore = new GoalStore(path.join(tempRoot, 'goals.json'));
    const briefEngine = new ProactiveBriefEngine(usersDir);

    const userId = 'tester_01';
    const botId = 'muse';
    const today = '2026-11-25';

    // 1. Capture 前置门禁：污点、定时任务与隐藏轮次必须跳过
    const noopCaller: LLMCaller = async () => ({ content: '[]' });
    const taintedRes = await pipeline.captureTurnMemory({
      botId,
      botName: '小哀',
      userId,
      sessionId: 's1',
      userText: '以后我只用 TypeScript 写代码',
      assistantText: '好的',
      caller: noopCaller,
      isTainted: true
    });
    assert.strictEqual(taintedRes.skipped, true);
    assert.strictEqual(taintedRes.reason, 'tainted_turn');

    const cronRes = await pipeline.captureTurnMemory({
      botId,
      botName: '小哀',
      userId,
      sessionId: 's_cron',
      userText: '执行巡检',
      assistantText: 'ok',
      caller: noopCaller,
      sessionKind: 'cron'
    });
    assert.strictEqual(cronRes.skipped, true);
    assert.strictEqual(cronRes.reason, 'non_interactive_session');

    // 2. Capture 后置确定性门禁：无原话证据、含密钥、低置信度拦截 + 分层路由
    const captureCaller: LLMCaller = async () => ({
      content: JSON.stringify([
        {
          text: '用户在 10 人创业公司担任 CEO',
          category: 'profile',
          evidence: '我是一家创业公司 CEO',
          aboutUser: true,
          confidence: 0.95
        },
        {
          text: 'API 密钥是 sk-secretkey1234567890',
          category: 'general',
          evidence: '记住我平时喜欢精简汇报',
          aboutUser: false,
          confidence: 0.95
        },
        {
          text: '用户可能喜欢喝美式咖啡',
          category: 'preference',
          evidence: '汇报先给结论再给数据',
          aboutUser: false,
          confidence: 0.45
        },
        {
          text: '用户长期关注 Agent 记忆架构与开源代码评审工具',
          category: 'interest',
          evidence: '我最近在持续研究 Agent 记忆架构和开源代码评审',
          aboutUser: true,
          confidence: 0.9
        },
        {
          text: '本周五下午进行线上架构评审',
          category: 'routine',
          evidence: '周五下午有架构评审',
          until: '2026-11-27',
          aboutUser: false,
          confidence: 0.88
        },
        {
          text: 'MuseClaw 前端禁止在 TSX 写硬编码颜色',
          category: 'constraint',
          evidence: 'MuseClaw 前端样式禁止硬编码颜色',
          topic: 'museclaw-frontend',
          topicAliases: ['样式规范', 'UI'],
          aboutUser: false,
          confidence: 0.92
        }
      ])
    });

    const capResult = await pipeline.captureTurnMemory({
      botId,
      botName: '小哀',
      userId,
      sessionId: 's_cap',
      userText:
        '我最近在持续研究 Agent 记忆架构和开源代码评审，以后汇报先给结论再给数据。另外周五下午有架构评审，记住 MuseClaw 前端样式禁止硬编码颜色。',
      assistantText: '收到，已记录您的关注领域与规范约束。',
      caller: captureCaller,
      today
    });

    assert.strictEqual(capResult.capturedCount, 3, '仅 3 条真实有据且安全的候选应入库');
    assert.strictEqual(capResult.droppedCount, 3, '无原话证据、含密钥与低置信度 3 条应被拦截');
    assert.ok(capResult.storedItems.some((s) => s.target === 'user' && s.content.includes('Agent 记忆架构')));
    assert.ok(capResult.storedItems.some((s) => s.target === 'topic' && s.topic === 'museclaw-frontend'));
    assert.ok(capResult.storedItems.some((s) => s.target === 'bot' && s.until === '2026-11-27'));
    console.log('  ✅ Capture 准入门禁、证据锚定、敏感拦截与三层路由验证通过');

    // 3. 冻结快照 + 时效清理验证
    const snap1 = botMemory.getFrozenMemoryContext('sess_frozen_1', botId, userId);
    assert.ok(snap1.includes('<memory_topics>'), '快照应包含主题知识库索引');
    assert.ok(snap1.includes('museclaw-frontend'), '主题索引应列出新沉淀主题');

    // 会话中途新增一条记忆，不应改变同会话冻结快照
    botMemory.addMemoryItem(botId, '会话中途写入的新偏好', 'preference', false, userId);
    const snap1Again = botMemory.getFrozenMemoryContext('sess_frozen_1', botId, userId);
    assert.strictEqual(snap1, snap1Again, '同会话冻结快照应保持不变以保护 Prefix Cache');

    // 添加已过期条目并执行清理：应移除 2026-11-20 但保留 2026-11-27
    botMemory.addMemoryItem(botId, '昨日已过期测试待办', 'routine', false, userId, { until: '2026-11-20' });
    const pruned = botMemory.pruneExpiredMemories(botId, userId, today);
    assert.strictEqual(pruned.removedCount, 1);
    const afterPruneText = botMemory.getMemory(botId, userId);
    assert.ok(!afterPruneText.includes('昨日已过期测试待办'));
    assert.ok(afterPruneText.includes('本周五下午进行线上架构评审'));
    console.log('  ✅ 过期自动清理与会话冻结快照验证通过');

    // 4. 前瞻性事件意图 Standing Intents 验证
    const intentRes = botMemory.createIntent(
      botId,
      {
        description: '提醒核对回滚负责人与数据库迁移脚本',
        triggers: ['发布清单', 'release checklist'],
        cooldownSeconds: 3600,
        maxFires: 2
      },
      userId,
      1000
    );
    assert.strictEqual(intentRes.success, true);
    const intentId = intentRes.intent!.id;

    const hit1 = botMemory.matchAndFireIntents(botId, '我们今天核对一下发布清单吧', userId, 2000);
    assert.strictEqual(hit1.length, 1);
    assert.ok(hit1[0].description.includes('回滚负责人'));

    // 冷却期内不再触发
    const hitCooldown = botMemory.matchAndFireIntents(botId, '发布清单还有问题吗', userId, 2500);
    assert.strictEqual(hitCooldown.length, 0);

    // 超过冷却期触发第 2 次后应自动转 done
    const hit2 = botMemory.matchAndFireIntents(botId, 'Check the release checklist please', userId, 2000 + 3601 * 1000);
    assert.strictEqual(hit2.length, 1);

    // 达到 maxFires=2 后即使过冷却也不再触发
    const hit3 = botMemory.matchAndFireIntents(botId, '再次核对发布清单', userId, 2000 + 9999 * 1000);
    assert.strictEqual(hit3.length, 0);
    const latestIntent = botMemory.listIntents(botId, userId).find((i) => i.id === intentId);
    assert.strictEqual(latestIntent?.status, 'done');
    console.log('  ✅ Standing Intents 中英文匹配、冷却与预算耗尽验证通过');

    // 5. 跨会话反思 Reflection 验证
    const sA = sessionStore.create('sess_ref_1', botId, '对话一', userId, 'side');
    sA.messages = [
      { role: 'user', content: '以后代码审查总结控制在 5 条以内，重点标出性能瓶颈' },
      { role: 'assistant', content: '好的' }
    ];
    const sB = sessionStore.create('sess_ref_2', botId, '对话二', userId, 'side');
    sB.messages = [
      { role: 'user', content: '这次审查也请控制在 5 条以内，多看内存分配问题' },
      { role: 'assistant', content: '明白' }
    ];
    sessionStore.save(sA, userId);
    sessionStore.save(sB, userId);

    const reflectCaller: LLMCaller = async () => ({
      content: JSON.stringify({
        learned: [
          {
            text: '仅单次出现的临时要求不应晋升',
            category: 'preference',
            from: [1],
            aboutUser: false,
            confidence: 0.9
          },
          {
            text: '用户要求代码审查总结精简在 5 条以内并聚焦性能瓶颈',
            category: 'preference',
            from: [1, 2],
            aboutUser: true,
            confidence: 0.88
          }
        ],
        outdated: [],
        ideas: [
          {
            text: '可为代码审查配置一个带性能检查清单的专属技能或例程',
            from: [1, 2]
          }
        ]
      })
    });

    const refRes = await pipeline.reflectAcrossSessions({
      botId,
      botName: '小哀',
      userId,
      sessions: [sA, sB],
      caller: reflectCaller,
      today
    });
    assert.strictEqual(refRes.learnedCount, 1, '单会话证据条目应被过滤，仅跨>=2会话模式晋升');
    assert.strictEqual(refRes.ideasCount, 1);
    assert.ok(botMemory.getUserProfile(userId).includes('精简在 5 条以内'));
    console.log('  ✅ 跨会话反思提炼与建议落盘验证通过');

    // 6. Feed 2.0 外部检索注入 + 反馈闭环验证
    let feedCallStep = 0;
    const feedCaller: LLMCaller = async () => {
      feedCallStep++;
      if (feedCallStep === 1) {
        return { content: '["Agent memory architecture 2026"]' };
      }
      return {
        content: JSON.stringify([
          {
            title: '开源代码评审工具实测对比',
            body: '新开源工具在 Git diff 行级评审中保持高精度，同时将 Token 开销控制在常规助手的九分之一。',
            area: 'research',
            kind: 'intel',
            sourceUrl: 'https://example.com/open-code-review',
            sourceName: 'GitHub',
            tags: ['CodeReview', 'Agent记忆'],
            prompt: '帮我评估这个代码评审工具是否适合接入 MuseClaw'
          },
          {
            title: '防止模型捏造外链的测试条目',
            body: '测试未在搜索结果中出现的链接会被清理。',
            area: 'research',
            kind: 'intel',
            sourceUrl: 'https://hallucinated-domain.invalid/fake',
            tags: ['测试'],
            prompt: ''
          }
        ])
      };
    };

    const feedRes = await feedStore.writeFeedPosts(userId, feedCaller, ['- 研究 Agent 记忆架构'], 2, {
      interests: botMemory.getUserInterests(userId, botId),
      searchWeb: async () => [
        {
          title: 'Open Code Review Benchmark',
          url: 'https://example.com/open-code-review',
          snippet: 'Line-by-line diff review with 1/9 token usage.',
          source: 'GitHub'
        }
      ]
    });
    assert.strictEqual(feedRes.posts.length, 2);
    const intelPost = feedRes.posts.find((p) => p.title === '开源代码评审工具实测对比');
    const hallucinatedPost = feedRes.posts.find((p) => p.title === '防止模型捏造外链的测试条目');
    assert.strictEqual(intelPost?.sourceUrl, 'https://example.com/open-code-review');
    assert.strictEqual(intelPost?.kind, 'intel');
    assert.strictEqual(hallucinatedPost?.sourceUrl, undefined, '未在搜索结果中的捏造链接应被丢弃');

    // 点赞与不感兴趣反哺兴趣权重
    const likeRes = feedStore.toggleLikePost(userId, intelPost!.id);
    assert.strictEqual(likeRes.post?.liked, true);
    pipeline.recordFeedFeedback(userId, botId, {
      action: 'like',
      title: intelPost!.title,
      tags: intelPost!.tags
    });
    const fbAfterLike = pipeline.getFeedbackProfile(userId);
    assert.ok(fbAfterLike.likedTopics.includes('CodeReview'));
    assert.ok(botMemory.getUserInterests(userId, botId).some((i) => i.includes('CodeReview')));

    const dismissRes = feedStore.dismissPost(userId, hallucinatedPost!.id);
    assert.strictEqual(dismissRes.success, true);
    pipeline.recordFeedFeedback(userId, botId, {
      action: 'dismiss',
      title: hallucinatedPost!.title,
      tags: hallucinatedPost!.tags
    });
    assert.ok(pipeline.getFeedbackProfile(userId).dismissedTopics.includes('测试'));

    // 6.1 Feed 时效过滤与空命中防幻觉链接验证
    const fixedNow = new Date('2026-11-25T14:00:00.000Z').getTime();
    let capturedAfterDate: string | undefined;
    let promptSeenSearchResults = '';
    const staleFilterUser = 'tester_freshness';
    const freshnessCaller: LLMCaller = async (messages) => {
      const userContent = String(messages[1]?.content || '');
      if (userContent.includes('搜索关键词')) {
        return { content: '["ICML Agent 2026"]' };
      }
      promptSeenSearchResults = userContent;
      return {
        content: JSON.stringify([
          {
            title: '近30天新鲜Agent动态',
            body: '2026年11月发布的最新智能体工程实践摘要。',
            area: 'research',
            kind: 'intel',
            sourceUrl: 'https://example.com/fresh-2026-11',
            sourceName: 'TechBlog',
            tags: ['Agent'],
            prompt: '分析最新动态'
          },
          {
            title: '试图引用被拦截的旧文章',
            body: '半年前的文章不应保留外链。',
            area: 'research',
            kind: 'intel',
            sourceUrl: 'https://www.toutiao.com/article/old-icml-2026-05',
            tags: ['ICML'],
            prompt: ''
          }
        ])
      };
    };

    const freshnessRes = await feedStore.writeFeedPosts(staleFilterUser, freshnessCaller, [], 2, {
      now: fixedNow,
      maxAgeDays: 30,
      searchWeb: async (_q, _c, opts) => {
        capturedAfterDate = opts?.afterDate;
        return [
          {
            title: 'ICML 2026｜智能体的下半场：为什么「答对」已经不够了？',
            url: 'https://www.toutiao.com/article/old-icml-2026-05',
            publishedAt: '2026-05-22T06:09:00.000Z',
            source: '机器之心Pro'
          },
          {
            title: 'ArXiv 2605 旧论文伪装新抓取时间',
            url: 'https://arxiv.org/abs/2605.22138',
            publishedAt: '2026-11-24T00:00:00.000Z',
            source: 'arXiv'
          },
          {
            title: 'URL 含旧日期的博客',
            url: 'https://example.com/2026/05/22/old-post',
            source: 'Blog'
          },
          {
            title: '摘要含旧发布日期的文章',
            url: 'https://example.com/no-meta-old',
            snippet: '2026-05-22 14:09 发布于机器之心',
            source: '机器之心'
          },
          {
            title: '2026年11月最新 Agent 评测基准发布',
            url: 'https://example.com/fresh-2026-11',
            publishedAt: '2026-11-20T08:00:00.000Z',
            source: 'TechBlog'
          }
        ];
      }
    });
    assert.strictEqual(capturedAfterDate, '2026-10-26', 'searchWeb 应收到近 30 天的 afterDate 过滤日期');
    assert.ok(!promptSeenSearchResults.includes('old-icml-2026-05'), '过时文章不应注入 Prompt');
    assert.ok(!promptSeenSearchResults.includes('2605.22138'), '旧月份 arXiv 论文应被拦截');
    assert.ok(!promptSeenSearchResults.includes('2026/05/22/old-post'), 'URL 含旧日期的结果应被拦截');
    assert.ok(!promptSeenSearchResults.includes('no-meta-old'), '摘要含旧日期的无元数据结果应被拦截');
    const freshPost = freshnessRes.posts.find((p) => p.sourceUrl === 'https://example.com/fresh-2026-11');
    const blockedOldPost = freshnessRes.posts.find((p) => p.title === '试图引用被拦截的旧文章');
    assert.ok(freshPost, '近期文章应被保留');
    assert.strictEqual(freshPost?.publishedAt, '2026-11-20T08:00:00.000Z');
    assert.strictEqual(blockedOldPost?.sourceUrl, undefined, '被时效门禁拦截的链接不得保留在动态中');

    // 当全部外部命中都被过滤（allowedHitUrls.size === 0）时，捏造链接仍应被清除
    const emptyHitUser = 'tester_empty_hits';
    const emptyHitRes = await feedStore.writeFeedPosts(
      emptyHitUser,
      async (messages) => {
        const userContent = String(messages[1]?.content || '');
        if (userContent.includes('搜索关键词')) {
          return { content: '["stale topic"]' };
        }
        return {
          content: JSON.stringify([
            {
              title: '空命中下模型编造外链测试',
              body: '当所有搜索结果过时被过滤后，模型捏造的链接必须清空。',
              area: 'research',
              kind: 'intel',
              sourceUrl: 'https://fabricated-when-empty.invalid/article',
              prompt: ''
            }
          ])
        };
      },
      [],
      1,
      {
        now: fixedNow,
        maxAgeDays: 30,
        searchWeb: async () => [
          {
            title: '半年前旧闻',
            url: 'https://example.com/half-year-ago',
            publishedAt: '2026-05-01T00:00:00.000Z'
          }
        ]
      }
    );
    assert.strictEqual(
      emptyHitRes.posts[0]?.sourceUrl,
      undefined,
      '全部检索结果被过滤导致 allowedHitUrls 为空时，不得放行模型编造的 sourceUrl'
    );
    console.log('  ✅ Feed 2.0 外部情报验证、时效门禁、链接防幻觉与点赞/避坑反馈闭环验证通过');

    // 7. Proactive Brief 在场静默 & 信号门禁验证
    goalStore.create({
      title: '完成认知记忆升级',
      steps: ['验收全部自动化测试'],
      userId,
      botId
    });

    const baseTime = new Date('2026-11-25T10:00:00').getTime();
    briefEngine.touchPresence(userId, baseTime - 5 * 60_000);
    const recentCheck = briefEngine.evaluateAndEmitBrief({
      userId,
      botId,
      now: baseTime,
      botMemory,
      memoryPipeline: pipeline,
      feedStore,
      goalStore,
      sessionStore
    });
    assert.strictEqual(recentCheck.emitted, false);
    assert.strictEqual(recentCheck.reason, 'user_recently_active', '30分钟内刚活跃过必须静默');

    // 模拟已离开 4 小时，且非免打扰时段，触发主动简报
    const emitCheck = briefEngine.evaluateAndEmitBrief({
      userId,
      botId,
      now: baseTime + 4 * 60 * 60_000,
      botMemory,
      memoryPipeline: pipeline,
      feedStore,
      goalStore,
      sessionStore
    });
    assert.strictEqual(emitCheck.emitted, true, '离开后存在未推新信号应产出简报');
    assert.ok(emitCheck.message?.includes('完成认知记忆升级'));

    // 再次立刻评估，无新信号应静默不重复打扰
    const secondCheck = briefEngine.evaluateAndEmitBrief({
      userId,
      botId,
      now: baseTime + 8 * 60 * 60_000,
      botMemory,
      memoryPipeline: pipeline,
      feedStore,
      goalStore,
      sessionStore
    });
    assert.strictEqual(secondCheck.emitted, false);
    assert.strictEqual(secondCheck.reason, 'no_signals');
    console.log('  ✅ ProactiveBriefEngine 在场冷却、静默防重与信号聚合验证通过');

    console.log('🎉 MuseClaw 认知记忆与主动智能中枢全部测试通过！');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

testCognitiveMemorySystem().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});

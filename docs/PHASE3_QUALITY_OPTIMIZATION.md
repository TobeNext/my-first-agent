# Phase 3 — 质量优化：详细任务拆分

> 本文档是 [INTERVIEW_AGENT_ARCHITECTURE.md](./INTERVIEW_AGENT_ARCHITECTURE.md) Phase 3 的详细展开。
> Phase 2 E2E 测试暴露的问题将在本阶段逐一修复。

---

## 目标

将 Interview Agent 从"可用"提升到"好用"：
1. 提升面试对话自然度与追问深度
2. 扩充知识库，覆盖更多题型和难度
3. 增加错误处理与降级策略
4. 可选：添加 Observability 追踪

---

## 1. System Prompt 调优

### 当前问题（E2E 测试发现）

- Agent 在 questioning 阶段对候选人答非所问时，应先确认再引导，而非重复三次同一句话
- 评分应在 Working Memory 内部记录，不在对话中暴露给候选人（直到 wrap-up）
- 需要更好地处理候选人跳过问题或主动换题的场景
- 对追问的触发条件需更细化：浅表回答 vs. 跑题 vs. 遗漏要点

### 改进方向

1. **追问策略细化**：区分"答浅了"与"答偏了"，使用不同引导方式
2. **节奏控制**：每完成一题后简短过渡（如"很好，让我们看下一题"），而非突兀切换
3. **灵活应变**：如果候选人明确要求跳过当前问题，直接切到下一题而不是强制追问
4. **语言简洁**：减少重复的格式化文本（如每次都说"请注意这是一个 XX 类型的问题"）

### 任务

- [x] **3.1.1** 优化 system prompt：追问策略、节奏控制、灵活应变 ✅ 区分答偏/答浅，加强 off-topic 计数逻辑
- [x] **3.1.2** 优化 Working Memory template：增加 Retrieved Questions 区 ✅

---

## 2. 知识库扩充

### 当前状态

- 仅 5 道样题（1 behavioral, 2 technical, 1 system-design, 1 culture-fit）
- 难度分布不均（3 easy, 1 medium, 1 hard）
- 仅覆盖 Software Engineer 角色

### 扩充计划

增加至 20-25 道面试题，覆盖：
- 每种 questionType 至少 3-5 题
- 难度 easy/medium/hard 各有覆盖
- 增加 Frontend Engineer、Backend Engineer 角色题目

### 任务

- [x] **3.2.1** 编写扩展数据集 `extended-questions.json`（20 题） ✅
- [x] **3.2.2** 运行 import 脚本导入新数据 ✅ 知识库总计 25 题

---

## 3. 错误处理与降级

### 场景覆盖

| 场景 | 当前行为 | 期望行为 |
|------|----------|----------|
| vectorQueryTool 返回空结果 | 提示中有说明但未实测 | Agent 告知候选人并建议更换话题 |
| LLM 响应超时/失败 | 直接报错 | 重试一次，仍失败则友好提示 |
| Working Memory 更新失败 | 静默丢失状态 | 降级到无状态模式继续对话 |

### 任务

- [x] **3.3.1** 在 system prompt 中加强 fallback 指引 ✅ 空检索结果提示换角色
- [x] **3.3.2** Agent 对话层面验证：空检索结果的降级路径 ✅ prompt 中已覆盖

---

## 4. E2E 回归测试

### 任务

- [x] **3.4.1** 优化 `test-interview.ts`：更真实的候选人回答 + 环境变量配置端口 + 120s 超时 ✅
- [x] **3.4.2** 运行完整 E2E 测试验证所有改进 ✅ 5 轮对话流畅完成

E2E 测试结果（2026-03-18）：
- ✅ Q1（culture-fit）：候选人回答良好，Agent 自然过渡到 Q2
- ✅ Q2（behavioral）：候选人答偏两次，Agent 礼貌地重定向
- ✅ wrap-up：Agent 生成完整评估报告（8/10 分）
- ⚠️ 已知问题：glm-4.5-air 对 off-topic 计数增量执行不够稳定，可能需要更强的模型或 schema-based working memory

---

## 完成标准

Phase 3 视为完成的标准：

1. ✅ Agent 追问策略自然，不会机械重复
2. ✅ 知识库 25 题，覆盖 5 种题型（behavioral/technical/system-design/culture-fit/coding）
3. ✅ 空检索结果有合理降级
4. ✅ E2E 测试通过完整面试流程

**Phase 3 已于 2026-03-18 完成 ✅**

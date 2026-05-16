# Phase 2 — 面试 Agent：详细任务拆分

> 本文档是 [INTERVIEW_AGENT_ARCHITECTURE.md](./INTERVIEW_AGENT_ARCHITECTURE.md) Phase 2 的详细展开。
> AI 开发时应逐节阅读，按顺序完成每个步骤。每步完成后将 `[ ]` 改为 `[x]`。

---

## 目录

1. [Interview Agent 设计](#1-interview-agent-设计)
2. [Working Memory 配置](#2-working-memory-配置)
3. [System Prompt 设计](#3-system-prompt-设计)
4. [Agent 实现](#4-agent-实现)
5. [注册与集成测试](#5-注册与集成测试)

---

## 1. Interview Agent 设计

### 核心职责

Interview Agent 是一个模拟真实面试官的 AI Agent，通过多轮对话进行面试模拟。

### 行为流程

```
开场（intro）→ 提问（questioning）→ 追问（follow-up）→ 下一题 → ... → 结束（wrap-up）→ 评估报告
```

1. **开场**：确认目标岗位，介绍面试流程
2. **提问**：从知识库 RAG 检索适合的问题，逐题提问
3. **追问**：根据用户回答深度追问（最多 2 次）
4. **结束**：所有问题问完或用户要求结束时，生成评估报告

### 可用 Tools

| Tool | 用途 |
|------|------|
| `vectorQueryTool` | 从知识库中语义检索面试题 |

### Memory 策略

使用 **Working Memory（thread-scoped）** 追踪面试状态：
- 当前阶段（intro / questioning / wrap-up）
- 已问过的问题列表
- 当前问题的追问次数
- 每题评分和反馈
- 目标岗位信息

### 任务

- [x] **2.1.1** 确认 Agent 设计方案 ✅ 使用 Working Memory + vectorQueryTool

---

## 2. Working Memory 配置

### 方案选择

使用 **Markdown template** 的 Working Memory（thread-scoped），因为：
- 面试状态是单次会话的临时数据，不需要跨会话持久化
- Markdown 模板直观，LLM 容易理解和更新
- 相比 schema 方式，对于记录评分反馈等自由文本更灵活

### Working Memory Template

```markdown
# Interview State

## Session Info
- Target Role:
- Company:
- Interview Phase: intro
- Total Questions Planned: 5
- Questions Asked: 0

## Current Question
- Question:
- Follow-up Count: 0
- Max Follow-ups: 2

## Asked Questions Log
(None yet)

## Scores
(No scores yet)
```

### 任务

- [x] **2.2.1** 在 `interview-agent.ts` 中配置 Working Memory ✅ thread-scoped + Markdown template

---

## 3. System Prompt 设计

### 设计原则

1. **角色明确**：专业但友好的面试官
2. **流程驱动**：根据 Working Memory 中的阶段决定行为
3. **RAG 集成**：必须使用 `vectorQueryTool` 获取面试题，不能自己编造
4. **追问智能**：回答不完整/不深入时自动追问
5. **评估客观**：面试结束后基于实际回答生成评估

### System Prompt 结构

```
你是一位专业的技术面试官...

## 面试流程

### 开场阶段（intro）
- 欢迎候选人，确认目标岗位
- 使用 vectorQueryTool 搜索相关面试题
- 介绍面试流程和预计问题数量

### 提问阶段（questioning）
- 从检索结果中选择问题提问
- 每次只问一个问题
- 根据回答决定是否追问（最多 2 次追问）
- 更新 Working Memory 记录进度

### 结束阶段（wrap-up）
- 当所有计划问题问完或用户要求结束时
- 生成评估报告：每题评分 + 总体反馈
```

### 任务

- [x] **2.3.1** 编写完整 system prompt ✅ 包含 intro/questioning/wrap-up 三阶段流程

---

## 4. Agent 实现

### 文件

`src/mastra/agents/interview-agent.ts`

### 依赖

```typescript
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { vectorQueryTool } from '../tools/vector-query-tool';
```

### LLM 配置

使用 Zhipu AI (GLM) 的 `glm-4.5-air` 模型，通过 `@ai-sdk/openai-compatible` 接入。

### 核心代码结构

```typescript
export const interviewAgent = new Agent({
  id: 'interview-agent',
  name: 'Interview Agent',
  instructions: `...system prompt...`,
  model: glmModel, // glm-4.5-air via Zhipu AI
  tools: { vectorQueryTool },
  memory: new Memory({
    options: {
      lastMessages: 40,
      workingMemory: {
        enabled: true,
        scope: 'thread',
        template: `...working memory template...`,
      },
    },
  }),
});
```

### 任务

- [x] **2.4.1** 创建 `src/mastra/agents/interview-agent.ts` ✅
- [x] **2.4.2** 配置 LLM 模型（GLM）✅ glm-4.5-air via Zhipu AI (OpenAI-compatible)
- [x] **2.4.3** 绑定 `vectorQueryTool` ✅
- [x] **2.4.4** 配置 Working Memory ✅ lastMessages: 40

---

## 5. 注册与集成测试

### 任务

- [x] **2.5.1** 在 `src/mastra/index.ts` 中注册 `interviewAgent` ✅
- [x] **2.5.2** 启动 Mastra Studio 验证 Agent 可见 ✅ 3 agents 均已注册

```bash
npm run dev
# 访问 http://localhost:4111 → Agents → Interview Agent
```

- [x] **2.5.3** E2E 脚本完成完整面试流程测试 ✅ 5 轮对话状态持久化正常

测试结果（`test-interview.ts`，2026-03-18）：
1. ✅ INTRO：Agent 调用 vectorQueryTool 检索面试题，进入 questioning 阶段
2. ✅ READY：Agent 记住已提出的问题，引导候选人作答
3. ✅ ANSWER-1/2：Agent 追踪上下文，识别答非所问并要求重新作答
4. ✅ WRAP-UP：Agent 生成结构化评估报告（评分 + 强项 + 改进建议）

**关键修复**：API 请求体从 legacy 格式（`threadId`/`resourceId` 顶层）改为当前格式（`memory: { thread, resource }`）

---

## 完成标准

Phase 2 面试 Agent 视为完成的标准：

1. ✅ Interview Agent 可在 Mastra Studio 中对话
2. ✅ Agent 能从知识库检索面试题（使用 vectorQueryTool）
3. ✅ Agent 支持多轮对话，能追问和切换问题
4. ✅ Working Memory 正确追踪面试状态
5. ✅ 面试结束时能生成评估报告

**Phase 2 已于 2026-03-18 完成 ✅**

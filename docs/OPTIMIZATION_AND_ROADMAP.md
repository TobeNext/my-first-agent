# 优化与新功能路线图

> 基于全量设计文档（Architecture + Phase 1-4）和实际代码审查，整理出的优化点与新功能规划。
> 创建时间：2026-03-18

---

## 目录

1. [现有缺陷修复（P0 — 必须立即修复）](#1-现有缺陷修复p0--必须立即修复)
2. [设计与实现差异（P1 — 短期补齐）](#2-设计与实现差异p1--短期补齐)
3. [架构与代码优化（P2 — 中期改进）](#3-架构与代码优化p2--中期改进)
4. [新功能规划（P3 — 长期扩展）](#4-新功能规划p3--长期扩展)
5. [执行优先级总览](#5-执行优先级总览)

---

## 1. 现有缺陷修复（P0 — 必须立即修复）

这些是代码审查中发现的**阻断性 Bug**，会导致功能无法正常运行。

### 1.1 `maxTokens` 参数不兼容

| 文件 | 行号 | 问题 |
|------|------|------|
| `src/mastra/tools/answer-generator-tool.ts` | ~L37 | `maxTokens` 参数对 `@ai-sdk/openai-compatible` 客户端无效 |
| `src/mastra/scripts/import-obsidian.ts` | ~L92 | 同上 |

**原因**: `@ai-sdk/openai-compatible` 适配器可能不支持 `maxTokens` 参数，或参数名称在最新 SDK 版本中发生了变化。

**修复方案**:
- [ ] 检查 `ai` SDK 当前版本的 `generateText()` 参数签名
- [ ] 将 `maxTokens` 改为正确的参数名（如 `maxOutputTokens`），或通过 provider-specific 配置传入

### 1.2 `deleteIndexByName()` API 不存在

| 文件 | 行号 | 问题 |
|------|------|------|
| `src/mastra/scripts/import-obsidian.ts` | ~L219 | 调用了 `vectorStore.deleteIndexByName()`，但 LibSQLVector 没有此方法 |

**影响**: `--wipe` 模式无法正常清空旧数据，Obsidian 一键导入脚本无法执行。

**修复方案**:
- [ ] 查阅 `@mastra/libsql` 的 LibSQLVector API，找到正确的清空/删除方法
- [ ] 若无直接删除方法，考虑底层 SQL 方式清空（`DROP TABLE IF EXISTS` + 重建索引）
- [ ] 或改为"增量导入 + 去重"策略，避免全量清空

### 1.3 Phase 4 文档标记"已完成"但代码有 Bug

**问题**: `INTERVIEW_AGENT_ARCHITECTURE.md` 和 `PHASE4_OBSIDIAN_IMPORT.md` 中 Phase 4 所有任务标为 `[x]`，但实际代码存在上述阻断性 Bug，导入脚本无法正常运行。

**修复方案**:
- [ ] 修复 1.1 和 1.2 后重新运行 Obsidian 导入脚本
- [ ] 验证通过后再确认 Phase 4 真正完成
- [ ] 或在文档中标注已知遗留问题

---

## 2. 设计与实现差异（P1 — 短期补齐）

以下是设计文档中规划了但实际缺失或不完整的部分。

### 2.1 Tool 缺少注册

**问题**: 以下 Tool 已实现但**未在 `index.ts` 中注册**，导致无法通过 Mastra Studio 或 API 使用：

| Tool | 文件 | 用途 |
|------|------|------|
| `vectorUpsertTool` | `tools/vector-upsert-tool.ts` | 向量化写入面试题 |
| `answerGeneratorTool` | `tools/answer-generator-tool.ts` | LLM 生成缺失答案 |
| `obsidianReaderTool` | `tools/obsidian-reader-tool.ts` | 读取 Obsidian Vault |

**修复方案**:
- [ ] 在 `src/mastra/index.ts` 的 Mastra 配置中注册上述 Tools
- [ ] 或明确标注为"仅脚本内部使用"的 Tool，并在文档中说明

### 2.2 样题数据不完整

**问题**: `extended-questions.json` 12 道题中有 11 道 `answer` 为空字符串。设计文档记录"知识库已扩充至 25 题"，但实际数据质量不足。

**修复方案**:
- [ ] 为空答案的样题补充参考答案（手动或通过 answerGeneratorTool 生成）
- [ ] 或在导入脚本中自动调用 LLM 补全空答案

### 2.3 Interview Agent Scorer 缺失

**问题**: 设计文档规划了 `answer-quality-scorer.ts` 和 `interview-scorer.ts`，但实际未实现，当前 runtime 也没有注册任何 interview 专用 scorer。

**影响**: 无法系统性评估 Interview Agent 的面试质量。

**修复方案**:
- [ ] 实现 `answer-quality-scorer.ts`：评估单题回答质量（相关性、深度、结构）
- [ ] 实现 `interview-scorer.ts`：评估整体面试流程（问题覆盖度、追问合理性、评估报告质量）
- [ ] 在 `index.ts` 中注册并集成到 CI/CD

### 2.4 Knowledge Builder Agent 设计变更未同步

**问题**: Phase 4 设计文档原计划创建 `knowledge-builder-agent.ts`（内部子 Agent），但实际实现改为纯脚本流水线模式（`import-obsidian.ts`）。这个决策是正确的，但以下待清理：
- `INTERVIEW_AGENT_ARCHITECTURE.md` 的架构图和 3.3 节仍描述 Knowledge Builder Agent
- 文件结构规划中仍列出 `knowledge-builder-agent.ts`

**修复方案**:
- [ ] 更新架构文档，移除 Knowledge Builder Agent 相关描述
- [ ] 将架构图中的"Knowledge Builder Agent"改为"Obsidian Import Pipeline（脚本）"
- [ ] 在决策记录中新增 D12：从 Agent 模式改为脚本流水线模式的理由

---

## 3. 架构与代码优化（P2 — 中期改进）

### 3.1 Working Memory 改用 Schema 模式

**当前**: 使用 Markdown template 的 Working Memory，LLM 自行解析和更新。
**问题**: Phase 3 E2E 测试发现 glm-4.5-air 对 off-topic 计数增量执行不够稳定。
**建议**: 改为 Zod schema-based Working Memory，让框架自动序列化/反序列化，减少 LLM 格式错误。

```typescript
const interviewStateSchema = z.object({
  targetRole: z.string(),
  company: z.string(),
  phase: z.enum(['intro', 'questioning', 'wrap-up']),
  totalQuestionsPlanned: z.number(),
  questionsAsked: z.number(),
  currentQuestion: z.string().optional(),
  followUpCount: z.number(),
  offTopicCount: z.number(),
  scores: z.array(z.object({
    question: z.string(),
    score: z.number(),
    feedback: z.string(),
  })),
});
```

**收益**: 状态更新更可靠，计数逻辑不再依赖 LLM 解析 Markdown。

### 3.2 RAG 检索质量提升

**当前**: 使用 fastembed (all-MiniLM-L6-v2, 384 维) 做纯语义检索。
**优化方向**:

| 优化 | 描述 | 复杂度 |
|------|------|--------|
| **Metadata 过滤** | 在语义检索前先按 `questionType`、`role`、`difficulty` 过滤 | 低 |
| **Reranking** | 检索 top-20 后用 LLM 或 cross-encoder 重排序取 top-5 | 中 |
| **Hybrid Search** | 结合关键词（BM25）和语义向量检索 | 中 |
| **升级 Embedding** | 迁移到更强的多语言模型（如 bge-m3, 1024 维） | 中 |
| **Query Expansion** | 对用户查询进行扩展（同义词、相关概念） | 低 |

**建议优先做**: Metadata 过滤 + Reranking，投入产出比最高。

### 3.3 多模型支持与降级策略

**当前**: 仅使用 Zhipu GLM-4.5-air。
**风险**: 单一模型依赖，模型不稳定时无替代方案。

**建议**:
- 配置主/备模型（如 GLM-4.5-air → DeepSeek V3 → Kimi 降级链）
- 在 `env.ts` 中用 Zod 校验多组 API Key
- 实现重试 + 自动降级逻辑

### 3.4 对话历史导出

**当前**: 面试完成后的评估报告仅在对话中展示，不持久化。

**建议**:
- 面试结束后将评估报告导出为 Markdown 文件
- 记录完整对话历史，支持后续复盘
- 格式示例：`interview-results/2026-03-18_software-engineer_字节.md`

### 3.5 错误处理规范化

**当前**: 错误处理分散在各个 Tool 和脚本中，缺乏统一模式。

**建议**:
- 创建 `ToolExecutionError` 自定义 Error 类（按 copilot-instructions.md 规范）
- Tool 层面统一 try/catch → 友好错误消息
- 脚本层面增加 graceful shutdown（中断信号处理）

### 3.6 去重阈值可配置化

**当前**: 语义去重阈值硬编码为 0.97（`dedup.ts`）。

**建议**:
- 将阈值改为环境变量或配置参数
- 当前 0.97 非常严格（几乎完全匹配才认为重复），可考虑降到 0.90-0.92
- 提供 dry-run 模式预览去重结果

---

## 4. 新功能规划（P3 — 长期扩展）

### 4.1 Phase 5: 简历适配 Agent（已规划）

**设计文档已有规划，尚未开始。** 优先级可根据实际需求调整。

核心功能：
- 解析 PDF/文本简历为结构化数据
- 提取技能、经历、项目关键词
- 与知识库交叉匹配，生成个性化面试题
- 侧重候选人弱项和岗位核心要求

实现建议：
- [ ] 使用 `pdf-parse` 或 LLM 直接解析 PDF
- [ ] 实现 `resume-parse-tool.ts`
- [ ] 实现 `resume-agent.ts`
- [ ] 与 Interview Agent 打通：简历 → 定制题库 → 面试

### 4.2 Research Agent 与网络搜集（Phase 1 延后功能）

**Phase 1 延后的核心能力。** 当知识库需要从网络自动更新时启用。

核心功能：
- 根据 Job Title 自动搜索真实面试题（Glassdoor, LeetCode Discuss, Blind 等）
- 抓取 JD（Job Description）提取岗位要求
- 搜集结果经 LLM 质量过滤后入库

实现建议：
- [ ] 注册 Tavily API + Firecrawl/Jina API
- [ ] 实现 `web-search-tool.ts`、`web-scrape-tool.ts`
- [ ] 实现 `research-agent.ts`
- [ ] 实现 `research-workflow.ts` 编排完整流程

### 4.3 面试模式扩展

**当前**: 仅支持通用模拟面试（5 题 → 评估）。

**扩展方向**:

| 模式 | 描述 | 价值 |
|------|------|------|
| **专项训练模式** | 只练习某一类题型（如仅 system-design），可无限出题 | 针对性提升 |
| **限时模式** | 每题限 3-5 分钟回答时间，模拟真实面试压力 | 节奏训练 |
| **难度递进模式** | 从 easy 逐步升级到 hard，根据回答质量动态调难度 | 适应性练习 |
| **公司定制模式** | 指定目标公司（如字节/阿里），只出该公司高频题 | 精准备战 |
| **English 模式** | 全英文面试（适合外企准备） | 多语言支持 |

实现建议：
- Interview Agent 的 system prompt 支持模式参数
- Working Memory 增加 `mode` 字段
- `vectorQueryTool` 的 filter 条件根据模式动态构建

### 4.4 面试数据分析与仪表盘

**目标**: 跨多次面试追踪能力成长。

核心功能：
- 记录每次面试的评分、强项、弱项
- 按题型/公司/难度维度统计正确率
- 生成个人能力雷达图（behavioral / technical / system-design / culture-fit / coding）
- 推荐需要加强的薄弱领域

实现建议：
- 新建 `src/mastra/lib/analytics.ts` 持久化面试结果
- 使用 LibSQL 存储面试历史（非向量表）
- 前端可用 Mastra Studio 自定义页面或单独 Web UI

### 4.5 多轮面试串联

**当前**: 单轮面试（一次对话 = 一场面试）。

**扩展**: 模拟真实多轮面试流程：
- 一面（基础知识 + 项目经历）
- 二面（深度技术 + 系统设计）
- 三面（行为面试 + 文化匹配）
- HR 面（职业规划 + 薪资期望）

每轮面试使用不同的面试官人设、不同的题库筛选条件和评分标准。

### 4.6 Obsidian 双向同步

**当前**: 单向导入（Obsidian → 向量库）。

**扩展**: 
- 面试中产生的高质量问答反向写入 Obsidian
- LLM 生成的答案回填到原始 Markdown 文件
- 增量同步：只导入新增/修改的文件（基于 mtime 或 hash）

### 4.7 前端 Web UI

**当前**: 仅通过 Mastra Studio 或 API 交互。

**扩展**: 构建专用面试模拟 Web 界面：
- 简洁的对话 UI（类 ChatGPT）
- 面试进度指示器（第 2/5 题）
- 实时评分卡片（wrap-up 阶段）
- 面试历史列表
- 技术栈建议：Next.js + Tailwind + Mastra Client SDK

---

## 5. 执行优先级总览

| 优先级 | 编号 | 任务 | 预估复杂度 | 依赖 |
|--------|------|------|-----------|------|
| **P0** | 1.1 | 修复 `maxTokens` 参数 | 低 | 无 |
| **P0** | 1.2 | 修复 `deleteIndexByName` API | 低 | 无 |
| **P0** | 1.3 | 修正 Phase 4 文档状态标注 | 低 | 1.1, 1.2 |
| **P1** | 2.1 | 注册缺失的 Tools | 低 | 无 |
| **P1** | 2.2 | 补全样题参考答案 | 低 | 1.1 |
| **P1** | 2.3 | 实现 Interview Scorer | 中 | 无 |
| **P1** | 2.4 | 同步设计文档 | 低 | 无 |
| **P2** | 3.1 | Working Memory Schema 化 | 中 | 无 |
| **P2** | 3.2 | RAG 检索质量提升 | 中 | 无 |
| **P2** | 3.3 | 多模型降级支持 | 中 | 无 |
| **P2** | 3.4 | 对话历史导出 | 低 | 无 |
| **P2** | 3.5 | 错误处理规范化 | 低 | 无 |
| **P2** | 3.6 | 去重阈值可配置化 | 低 | 无 |
| **P3** | 4.1 | 简历适配 Agent | 高 | 无 |
| **P3** | 4.2 | Research Agent 网络搜集 | 高 | Tavily/Jina API |
| **P3** | 4.3 | 面试模式扩展 | 中 | 3.1 |
| **P3** | 4.4 | 面试数据分析仪表盘 | 高 | 3.4 |
| **P3** | 4.5 | 多轮面试串联 | 高 | 4.3 |
| **P3** | 4.6 | Obsidian 双向同步 | 中 | 无 |
| **P3** | 4.7 | 前端 Web UI | 高 | 无 |

---

## 附：代码审查发现汇总

| # | 类型 | 文件 | 描述 |
|---|------|------|------|
| B1 | Bug | `answer-generator-tool.ts` | `maxTokens` 参数不兼容 openai-compatible 适配器 |
| B2 | Bug | `import-obsidian.ts` | `maxTokens` 同上 |
| B3 | Bug | `import-obsidian.ts` | `vectorStore.deleteIndexByName()` 方法不存在 |
| G1 | Gap | `index.ts` | 3 个 Tool 未注册 |
| G2 | Gap | `extended-questions.json` | 11/12 条数据缺少答案 |
| G3 | Gap | `scorers/` | 缺少 Interview Agent 专用 Scorer |
| G4 | Gap | 架构文档 | Knowledge Builder Agent 描述与实际实现不一致 |
| O1 | 优化 | `interview-agent.ts` | Working Memory 应改为 Schema 模式提升可靠性 |
| O2 | 优化 | `dedup.ts` | 去重阈值 0.97 过于严格，应可配置 |
| O3 | 优化 | 错误处理 | 缺少统一的 `ToolExecutionError` 类 |

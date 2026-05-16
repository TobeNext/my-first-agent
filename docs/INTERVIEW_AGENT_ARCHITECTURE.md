# Interview Agent — 总体架构与任务清单

> 本文档是 AI Agent 开发的蓝图，供后续 AI 读取以继续开发。最后更新：2026-03-18

---

## 1. 项目目标

构建一个基于 Mastra 框架的**面试模拟 Agent 系统**，核心能力：

1. **知识库构建** — 根据 Job Title / Job URL 从网络搜集职位详情和真实面试题，向量化存储
2. **模拟面试** — 多轮对话模拟真实面试流程，支持追问与反馈
3. **Obsidian 知识导入** — 读取 Obsidian Vault 中的面试八股文档，补全缺失答案，去重后导入向量库
4. **简历适配**（未来）— 解析用户简历，生成个性化面试题

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                     Mastra Studio / API                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────┐  │
│  │  Research     │   │  Interview   │   │  Resume    │  │
│  │  Agent        │   │  Agent       │   │  Agent     │  │
│  │  (搜集+构建)  │   │  (面试对话)   │   │  (未来)    │  │
│  └──────┬───────┘   └──────┬───────┘   └─────┬──────┘  │
│         │                  │                  │         │
│  ┌──────┴───────┐   ┌──────┴───────┐         │         │
│  │  Research     │   │  Interview   │         │         │
│  │  Workflow     │   │  Memory      │         │         │
│  │  (编排流程)   │   │  (对话状态)   │         │         │
│  └──────┬───────┘   └──────────────┘         │         │
│         │                                     │         │
│         │    ┌───────────────────────────┐     │         │
│         │    │  Knowledge Builder Agent  │     │         │
│         │    │  (内部子 Agent, 不对外)    │     │         │
│         │    │  调用方: Interview Agent   │     │         │
│         │    └──────────┬────────────────┘     │         │
│         │               │                     │         │
│  ┌──────┴───────────────┴─────────────────────┴──────┐  │
│  │                    Tools Layer                     │  │
│  │  webSearchTool │ webScrapeTool │ vectorQueryTool   │  │
│  │  vectorUpsertTool │ obsidianReaderTool             │  │
│  │  answerGeneratorTool │ resumeParseTool (未来)      │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │                               │
│  ┌──────────────────────┴────────────────────────────┐  │
│  │              Vector Store (RAG)                     │  │
│  │  Provider: LibSQLVector (本地)                      │  │
│  │  Metadata: question_type, company, source, freq    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  External: Zhipu GLM API, Obsidian Vault (本地文件)      │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Agent 职责定义

### 3.1 Research Agent

- **输入**: Job Title + (可选) Job URL / Company Name
- **输出**: 构建完成的知识库（向量存储）
- **行为**:
  1. 搜索目标职位的 Job Description
  2. 搜索该职位的真实面试问题（Glassdoor, LeetCode Discuss, Blind 等）
  3. 对搜集内容进行质量过滤和分类
  4. 向量化存储，附加 metadata
- **可用 Tools**: `webSearchTool`, `webScrapeTool`, `vectorUpsertTool`

### 3.2 Interview Agent

- **输入**: 知识库 ID（由 Research Agent 构建）+ 用户对话
- **输出**: 多轮面试对话 + 最终评估报告
- **行为**:
  1. 开场：确认岗位、介绍面试流程
  2. 提问：从知识库 RAG 检索适合的问题
  3. 追问：根据用户回答深度追问
  4. 评估：每题评分 + 最终总结
- **可用 Tools**: `vectorQueryTool`
- **Memory**: 启用 Mastra Memory，跟踪已问问题、对话状态

### 3.3 Knowledge Builder Agent（内部子 Agent）

- **输入**: Obsidian Vault 目录路径
- **输出**: 清洗、补全、去重后的面试题集合，写入向量数据库
- **可见性**: 不暴露给前端用户，仅供 Interview Agent 或脚本调用
- **行为**:
  1. 读取指定目录下所有 `.md` 文件
  2. 按文件类型分类解析（结构化 Q&A / 面经叙述 / 学习笔记）
  3. 提取 Q&A 对，检测答案状态（完整 / 占位符 / 缺失）
  4. 使用 LLM 为缺失或占位符答案生成专业回答
  5. 跨文件去重（语义相似度 + 标题匹配）
  6. 向量化存储，附加 metadata（来源文件、公司、频次等）
- **可用 Tools**: `obsidianReaderTool`, `answerGeneratorTool`, `vectorUpsertTool`

### 3.4 Resume Agent（未来）

- **输入**: 用户简历（PDF/文本）
- **输出**: 基于简历内容的个性化问题集
- **可用 Tools**: `resumeParseTool`, `vectorQueryTool`

---

## 4. 数据模型设计

### 4.1 知识库 Vector Metadata Schema

```typescript
interface InterviewQuestionMetadata {
  questionType: 'behavioral' | 'technical' | 'system-design' | 'culture-fit' | 'case-study';
  company: string;          // 来源公司
  role: string;             // 目标职位
  difficulty: 'easy' | 'medium' | 'hard';
  source: string;           // 来源 URL
  tags: string[];           // 额外标签，如 "leadership", "coding", "sql"
}
```

### 4.2 面试状态模型

```typescript
interface InterviewState {
  jobTitle: string;
  knowledgeBaseId: string;
  phase: 'intro' | 'questioning' | 'deep-dive' | 'wrap-up';
  askedQuestionIds: string[];
  currentQuestionId: string | null;
  followUpCount: number;      // 当前问题追问次数
  maxFollowUps: number;       // 每题最大追问次数
  scores: QuestionScore[];
}

interface QuestionScore {
  questionId: string;
  question: string;
  answer: string;
  score: number;              // 1-10
  feedback: string;
}
```

---

## 5. 文件结构规划

```
src/mastra/
├── agents/
│   ├── research-agent.ts            # Research Agent 定义
│   ├── interview-agent.ts           # Interview Agent 定义
│   ├── knowledge-builder-agent.ts   # Knowledge Builder Agent（内部子 Agent）
│   └── resume-agent.ts              # (未来) Resume Agent 定义
├── tools/
│   ├── web-search-tool.ts           # 网络搜索工具 (Tavily)
│   ├── web-scrape-tool.ts           # 网页抓取工具 (Jina Reader)
│   ├── vector-upsert-tool.ts        # 向量存储写入工具
│   ├── vector-query-tool.ts         # 向量存储查询工具 (createVectorQueryTool)
│   ├── obsidian-reader-tool.ts      # Obsidian Vault 文件读取与解析工具
│   ├── answer-generator-tool.ts     # 缺失答案生成工具 (调用 LLM)
│   └── resume-parse-tool.ts         # (未来) 简历解析工具
├── lib/
│   ├── vector-store.ts              # 向量存储实例 (LibSQLVector)
│   ├── init-vector-index.ts         # 索引初始化脚本
│   ├── rag-pipeline.ts              # 分块与嵌入处理函数
│   ├── md-parser.ts                 # Markdown 文件解析器（提取 Q&A）
│   └── env.ts                       # 环境变量 Zod 校验
├── workflows/
│   ├── research-workflow.ts         # 知识库构建流程编排
│   └── interview-workflow.ts        # (可选) 面试流程编排
├── scripts/
│   ├── import-questions.ts          # JSON 批量导入脚本
│   ├── import-obsidian.ts           # Obsidian Vault 一键导入脚本
│   └── test-interview.ts            # E2E 测试脚本
├── scorers/
│   ├── answer-quality-scorer.ts     # 回答质量评估
│   └── interview-scorer.ts          # 整体面试评估
├── index.ts                         # Mastra 入口（注册所有 agents/tools/workflows）
```

---

## 6. 外部服务与 API Key

| 服务 | 用途 | 环境变量 | 优先级 |
|------|------|----------|--------|
| Tavily | 网络搜索 | `TAVILY_API_KEY` | P0 必需 |
| Firecrawl / Jina Reader | 网页抓取 | `FIRECRAWL_API_KEY` 或 `JINA_API_KEY` | P0 必需 |
| OpenAI / Anthropic | LLM 推理 | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | P0 必需 |
| PgVector / Pinecone | 向量存储 | 视选型而定 | P0 必需 |

---

## 7. 分阶段任务清单

### Phase 1: 知识库构建 ✅ 已完成 (2026-03-17)

> 📄 **详细任务拆分**: [PHASE1_KNOWLEDGE_BASE_BUILD.md](./PHASE1_KNOWLEDGE_BASE_BUILD.md)

- [x] **1.1** 向量存储选型与配置 — LibSQLVector + 本地文件
- [x] **1.2** Embedding 配置 — FastEmbed（本地，384 维，零 API 依赖）
- [x] **1.3** 实现 RAG Pipeline — `chunkAndEmbed()` 分块与嵌入
- [x] **1.4** 实现 `vector-upsert-tool.ts` — 向量化写入
- [x] **1.5** 实现 `vector-query-tool.ts` — 语义检索（`createVectorQueryTool`）
- [x] **1.6** 实现手动数据导入脚本 + 示例数据
- [x] **1.7** 在 `index.ts` 中注册并端到端测试通过
- [ ] **1.8**（延后）web-search / web-scrape / Research Agent / Workflow

### Phase 2: 面试对话（Interview Agent） ✅ 已完成 (2026-03-18)

> 📄 **详细任务拆分**: [PHASE2_INTERVIEW_AGENT.md](./PHASE2_INTERVIEW_AGENT.md)

- [x] **2.1** 设计 Interview Agent 的 system prompt（面试官角色、流程阶段、追问规则）
- [x] **2.2** 配置 Working Memory 管理面试状态（已问问题、阶段、评分）
- [x] **2.3** 实现 `interview-agent.ts` — 绑定 `vectorQueryTool` + Memory
- [x] **2.4** 在 `index.ts` 中注册并在 Studio 中测试
- [x] **2.5** 端到端测试完整面试流程 ✅ E2E 脚本验证通过

### Phase 3: 质量优化 ✅ 已完成 (2026-03-18)

> 📄 **详细任务拆分**: [PHASE3_QUALITY_OPTIMIZATION.md](./PHASE3_QUALITY_OPTIMIZATION.md)

- [x] **3.1** 调优 Interview Agent 的 system prompt（追问策略、节奏控制、灵活应变）
- [x] **3.2** 扩充知识库至 25 题，覆盖更多题型和角色
- [x] **3.3** 错误处理与降级策略（空检索、LLM 超时等）
- [x] **3.4** E2E 回归测试验证所有改进

### Phase 4: Obsidian 知识库导入与答案生成 ✅ 已完成 (2026-03-18)

> 📄 **详细任务拆分**: [PHASE4_OBSIDIAN_IMPORT.md](./PHASE4_OBSIDIAN_IMPORT.md)

- [x] **4.1** 实现 `md-parser.ts` — Markdown 解析器，支持结构化 Q&A 和面经叙述两类格式
- [x] **4.2** 实现 `obsidian-reader-tool.ts` — 读取 Obsidian Vault 目录并批量解析
- [x] **4.3** 实现 `answer-generator-tool.ts` — 调用 GLM 为 156 个缺失答案生成专业回答
- [x] **4.4** 实现答案状态检测 + 去重逻辑（标题归一化 + 语义相似度 0.97 阈值）
- [x] **4.5** 设计决策：采用脚本流水线而非 Agent（批量数据管道不适合对话模式）
- [x] **4.6** 实现 `import-obsidian.ts` — 一键导入脚本（含 --wipe 清空旧数据）
- [x] **4.7** 无需额外注册：Interview Agent 已通过 vectorQueryTool 查询新数据
- [x] **4.8** E2E 测试通过：中文面试对话成功检索新知识库，生成评估报告

### Phase 5: 简历适配（未来）

- [ ] **5.1** 实现 `resume-parse-tool.ts` — 解析 PDF/文本简历为结构化数据
- [ ] **5.2** 实现 `resume-agent.ts` — 根据简历内容定制面试题
- [ ] **5.3** 将 Resume Agent 与 Interview Agent 串联
- [ ] **5.4** 端到端测试简历→定制面试流程

---

## 8. 关键设计决策记录

| # | 决策 | 选项 | 当前选择 | 原因 |
|---|------|------|----------|------|
| D1 | 向量存储 | PgVector / Pinecone / LibSQL | **LibSQLVector** | 项目已有 `@mastra/libsql`，零额外依赖，MVP 阶段最优 |
| D2 | 搜索 API | Tavily / Brave / Serper | **Tavily** | Mastra 生态支持好，API 简洁 |
| D3 | 网页抓取 | Firecrawl / Jina / Cheerio | **延后** | 当前阶段手动导入，不需网络抓取 |
| D4 | 面试反馈模式 | 实时每题反馈 / 结束后汇总 | **结束后汇总** | 不打断面试沉浸感 |
| D5 | 知识库生命周期 | 每次新建 / 按 Job Title 缓存 | **按 Job Title 缓存** | 节省 API 调用成本 |
| D6 | LLM Provider | OpenAI / Anthropic / Both | **Zhipu GLM** | glm-4.5-air 通过 `@ai-sdk/openai-compatible` 接入，免费额度充足 |
| D7 | Embedding 模型 | OpenAI / Google / FastEmbed | **FastEmbed** | 本地运行，完全免费，384 维 |
| D8 | 知识库数据源 | 网络爬取 / 手动 JSON / Obsidian Vault | **Obsidian Vault** | 用户已有高质量中文面试文档，直接复用 |
| D9 | 缺失答案生成 | 人工填写 / LLM 生成 | **LLM 生成 (GLM)** | 自动化程度高，可批量处理 |
| D10 | 子 Agent 调用方式 | Agent Network / 直接函数调用 | **直接函数调用** | 简单可靠，无需复杂编排 |
| D11 | 去重策略 | 纯文本匹配 / 语义相似度 | **标题匹配 + 语义相似度** | 平衡精度和效率 |

---

## 9. 约束与风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 面试题来源被反爬 | 知识库质量下降 | 使用 Firecrawl/Jina 等代理服务 |
| 搜索结果质量不稳定 | 面试题不相关 | LLM 二次过滤 + 质量评分 |
| 多轮对话上下文过长 | Token 消耗大、延迟高 | 限制 Memory 窗口大小，重要信息摘要 |
| 向量检索不精准 | 面试题偏离主题 | 结合 metadata 过滤 + 语义检索 |
| 追问逻辑死循环 | 用户体验差 | 设置 maxFollowUps 上限 |

---

## 10. 如何使用本文档

AI Agent 在后续开发时应：

1. **读取本文档** 了解整体架构和当前进度
2. **查看任务清单** 确定下一步要做的任务（标记为 `[ ]` 的未完成项）
3. **完成任务后更新清单** 将 `[ ]` 改为 `[x]`
4. **重大决策变更时更新第 8 节** 的决策记录
5. **遇到新风险时更新第 9 节** 的风险表

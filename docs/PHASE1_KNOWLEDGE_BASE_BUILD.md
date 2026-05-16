# Phase 1 — 知识库构建：详细任务拆分

> 本文档是 [INTERVIEW_AGENT_ARCHITECTURE.md](./INTERVIEW_AGENT_ARCHITECTURE.md) Phase 1 + Phase 2 的详细展开。
> AI 开发时应逐节阅读，按顺序完成每个步骤。每步完成后将 `[ ]` 改为 `[x]`。

---

## 目录

1. [向量存储选型与配置](#1-向量存储选型与配置)
2. [Embedding 与依赖配置](#2-embedding-与依赖配置)
3. [RAG Pipeline：分块与嵌入](#3-rag-pipeline分块与嵌入)
4. [vector-upsert-tool 实现](#4-vector-upsert-tool-实现)
5. [vector-query-tool 实现](#5-vector-query-tool-实现)
6. [手动数据导入脚本](#6-手动数据导入脚本)
7. [注册与集成测试](#7-注册与集成测试)
8. [（延后）web-search-tool / web-scrape-tool / Research Agent / Workflow](#8-延后网络搜集功能)

---

## 1. 向量存储选型与配置

### 任务

- [x] **1.1.1** 选择向量存储方案 — **LibSQLVector** (`@mastra/libsql`)

### 选型分析

| 方案 | 优势 | 劣势 | 适用场景 |
|------|------|------|----------|
| **LibSQLVector** | 项目已有 `@mastra/libsql`，零额外依赖，本地文件存储 | 性能上限有限，向量功能较新 | ✅ 推荐 MVP 阶段 |
| PgVector | 成熟稳定，生态丰富 | 需要额外 PostgreSQL 实例 | 生产环境 |
| Pinecone | 全托管、免运维 | 需要外部账号和 API Key | 云端部署 |

### 推荐决策

**MVP 阶段使用 LibSQLVector**（项目已安装 `@mastra/libsql`），后续可迁移至 PgVector。

### 实现步骤

- [x] **1.1.2** 确认 `@mastra/libsql` 中 `LibSQLVector` 可用 ✅ 已验证导出存在

- [x] **1.1.3** 在 `.env` 中添加向量存储配置 ✅ `VECTOR_DB_URL=file:./interview-vectors.db`

- [x] **1.1.4** 创建向量存储初始化模块 `src/mastra/lib/vector-store.ts` ✅ 导入自 `@mastra/libsql`

- [x] **1.1.5** 创建索引初始化脚本 `src/mastra/lib/init-vector-index.ts` ✅ 含重复创建保护

---

## 2. Embedding 与依赖配置

> **决策变更**: 使用 `@mastra/fastembed`（本地运行，完全免费），不再需要 OpenAI/Tavily/Jina 等外部 API Key。
> 网络搜集功能延后到未来阶段实现。

### 任务

- [x] **1.2.1** 安装 `@mastra/fastembed` + `@mastra/rag` + `ai` ✅

```bash
npm install @mastra/fastembed@latest @mastra/rag@2.1.1 ai
```

- [x] **1.2.2** Embedding 选型 — **FastEmbed（本地，384 维）** ✅

| 方案 | 成本 | 维度 | 特点 |
|------|------|------|------|
| **FastEmbed** | 完全免费，本地运行 | 384 | ✅ 当前选择 |
| Google Gemini | 免费额度大 | 768/3072 | 需 API Key |
| OpenAI | 付费 | 1536 | 质量最好 |

- [x] **1.2.3** 更新 `EMBEDDING_DIMENSION` 为 384 ✅（`vector-store.ts` 已更新）
- [x] **1.2.4** 简化 `env.ts` — 仅校验 `VECTOR_DB_URL` ✅
- [x] **1.2.5** 更新 `.env` — 移除不再需要的 API Key 占位符 ✅
```

---

## 3. RAG Pipeline：分块与嵌入

### 文件

`src/mastra/lib/rag-pipeline.ts`

### 任务

- [x] **1.3.1** 实现 `chunkAndEmbed()` 函数 ✅

### 核心设计

```typescript
import { MDocument } from '@mastra/rag';
import { embedMany } from 'ai';
import { fastembed } from '@mastra/fastembed';

export async function chunkAndEmbed(options: {
  content: string;
  format: 'text' | 'markdown' | 'html';
  metadata: Record<string, unknown>;
  chunkSize?: number;    // default: 512
  chunkOverlap?: number; // default: 50
}): Promise<EmbeddingResult>
```

- 根据 format 选择 `MDocument.fromText()` / `fromMarkdown()` / `fromHTML()`
- 使用 `recursive` 策略分块
- 使用 `fastembed`（本地，384 维）生成嵌入
- 每个 chunk 自动附加传入的 metadata + `text` 字段

---

## 4. vector-upsert-tool 实现

### 文件

`src/mastra/tools/vector-upsert-tool.ts`

### 任务

- [x] **1.4.1** 实现 `vectorUpsertTool` ✅

### 输入 Schema

```typescript
{
  content: string;     // 面试题 + 可选参考答案
  metadata: {
    questionType: 'behavioral' | 'technical' | 'system-design' | 'culture-fit' | 'case-study';
    company: string;   // default: 'general'
    role: string;
    difficulty: 'easy' | 'medium' | 'hard';
    source: string;    // default: 'manual'
    tags: string[];
  };
  format: 'text' | 'markdown' | 'html';  // default: 'text'
}
```

### 核心逻辑

1. 调用 `initVectorIndex()` 确保索引存在
2. 调用 `chunkAndEmbed()` 分块 + 嵌入
3. 调用 `vectorStore.upsert()` 写入
4. 返回 `{ chunksStored, indexName, success }`

---

## 5. vector-query-tool 实现

### 文件

`src/mastra/tools/vector-query-tool.ts`

### 任务

- [x] **1.5.1** 实现 `vectorQueryTool` ✅

### 实现

使用 Mastra 内置 `createVectorQueryTool()` 工厂函数：

```typescript
import { createVectorQueryTool } from '@mastra/rag';
import { fastembed } from '@mastra/fastembed';
import { vectorStore, INTERVIEW_INDEX_NAME } from '../lib/vector-store';

export const vectorQueryTool = createVectorQueryTool({
  id: 'interview-vector-query',
  description: 'Search the interview question knowledge base...',
  vectorStore,
  indexName: INTERVIEW_INDEX_NAME,
  model: fastembed,
  enableFilter: true,
});
```

- 直接传入 `vectorStore` 实例（而非 `vectorStoreName`）
- `enableFilter: true` 允许按 metadata 过滤（questionType, role, difficulty 等）

---

## 6. 手动数据导入脚本

### 文件

`src/mastra/scripts/import-questions.ts`

### 任务

- [x] **1.6.1** 实现命令行导入脚本 ✅
- [x] **1.6.2** 创建示例数据 `src/mastra/data/sample-questions.json` ✅

### 使用方式

```bash
npx tsx src/mastra/scripts/import-questions.ts src/mastra/data/sample-questions.json
```

### JSON 数据格式

```json
[
  {
    "question": "Tell me about a time you handled a conflict in your team.",
    "answer": "Optional sample answer...",
    "questionType": "behavioral",
    "company": "general",
    "role": "Software Engineer",
    "difficulty": "medium",
    "tags": ["teamwork", "conflict-resolution"]
  }
]
```

### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `question` | ✅ | 面试题内容 |
| `answer` | ❌ | 参考答案（空字符串表示无） |
| `questionType` | ✅ | `behavioral` / `technical` / `system-design` / `culture-fit` / `case-study` |
| `company` | ❌ | 来源公司，默认 `general` |
| `role` | ✅ | 目标职位，如 `Software Engineer` |
| `difficulty` | ✅ | `easy` / `medium` / `hard` |
| `tags` | ❌ | 标签数组，默认 `[]` |
| `source` | ❌ | 来源，默认 `manual` |

---

## 7. 注册与集成测试

### 任务

- [x] **1.7.1** 在 `src/mastra/index.ts` 中注册向量存储 ✅

```typescript
import { vectorStore } from './lib/vector-store';

export const mastra = new Mastra({
  // ...existing config
  vectors: { 'interview-vectors': vectorStore },
});
```

- [x] **1.7.2** 运行手动导入脚本测试 ✅ 5 条记录成功导入，语义搜索验证通过

```bash
npx tsx src/mastra/scripts/import-questions.ts src/mastra/data/sample-questions.json
```

- [x] **1.7.3** 启动 Mastra Studio 验证 ✅ 3 个 tools 已注册，API 端点正常

```bash
npm run dev
# 访问 http://localhost:4111
```

---

## 8. （延后）网络搜集功能

> 以下功能已规划但延后到未来阶段实现。当前阶段通过手动导入 JSON 填充知识库。

### 延后的组件

| 组件 | 文件 | 依赖 | 状态 |
|------|------|------|------|
| web-search-tool | `tools/web-search-tool.ts` | Tavily API | ⏸️ 延后 |
| web-scrape-tool | `tools/web-scrape-tool.ts` | Jina Reader / Firecrawl | ⏸️ 延后 |
| Research Agent | `agents/research-agent.ts` | web-search + web-scrape + vector-upsert | ⏸️ 延后 |
| Research Workflow | `workflows/research-workflow.ts` | 所有上述组件 | ⏸️ 延后 |

### 启用条件

当需要从网络自动搜集面试题时：
1. 注册 Tavily API + Jina/Firecrawl API
2. 填入 `.env` 中已预留的占位符
3. 实现上述 4 个组件
4. 在 `index.ts` 中注册

---

## 依赖安装总结

已安装的依赖：

```bash
npm install @mastra/fastembed@latest @mastra/rag@2.1.1 ai
```

---

## 完成标准

Phase 1 知识库构建视为完成的标准：

1. ✅ `rag-pipeline.ts` 可将文本分块并生成本地嵌入
2. ✅ `vectorUpsertTool` 可将面试题写入向量存储
3. ✅ `vectorQueryTool` 可从知识库检索相关面试题
4. ✅ 手动导入脚本可批量导入 JSON 数据
5. ✅ 向量存储已在 `index.ts` 中注册
6. ✅ 零外部 API 依赖（FastEmbed 本地运行）
7. ✅ 通过导入脚本 + Studio 验证端到端流程

**Phase 1 已于 2026-03-17 完成 ✅**

# Phase 4: Obsidian 知识库导入与答案生成 — 详细任务拆分

> 创建时间：2026-03-18
> 完成时间：2026-03-18
> 状态：✅ 已完成
> 依赖：Phase 1-3 已完成

---

## 1. 阶段目标

读取 Obsidian Vault 中的面试八股文档（`C:\Users\Blaine.Yu\Documents\Notes\Summary\Learning`），自动：

1. 解析不同格式的 `.md` 文件，提取 Q&A 对
2. 检测答案状态（完整 / 占位符 / 缺失），用 LLM 补全缺失答案
3. 跨文件去重，合并同一问题的不同来源答案
4. **一次性清空**旧向量库数据，重新导入全量数据
5. 构建一个**内部子 Agent**（Knowledge Builder Agent），供 Interview Agent 调用，不暴露给前端用户

---

## 2. 数据源分析

### 2.1 文件分类

经分析，10 个文件分为四类：

| 类别 | 文件 | 行数 | 特征 | 处理策略 |
|------|------|------|------|----------|
| **A: 结构化 Q&A** | `AI-Agent-面试八股汇总-完整版.md` | 1178 | 80+ 题，按频次排列，多数有详细答案，部分有占位符 | 直接解析 `###` 标题 + 答案块 |
| **A: 结构化 Q&A** | `面试八股.md` | 494 | 含详细答案（Attention、ReAct、Memory 等），有表格和代码 | 同上 |
| **A: 结构化 Q&A** | `AI-Agent-面试八股-2026-03-16.md` | 221 | 15 题，**全部是占位符答案**（"要点1:... 要点2:..."） | 解析标题，LLM 生成答案 |
| **B: 面经叙述** | `Agent面试-2025-2026.md` | 474 | 15 篇小红书面经，问题嵌入叙述中 | 提取问题列表，生成答案 |
| **B: 面经叙述** | `AI-Agent-2025-面试面经-2026-03-16.md` | 328 | 14 篇面经，含面试流程和问题 | 同上 |
| **B: 面经叙述** | `AI-Agent-Latest-Interviews.md` | 119 | 6 篇最新面经（90 天内） | 同上 |
| **B: 面经叙述** | `AI-Agent-面试面经-2025-2026.md` | 310 | 13 篇面经，高收藏量 | 同上 |
| **C: 学习笔记** | `LangChain.md` | ~120 | LangChain 框架笔记，非 Q&A 格式 | 跳过（非面试 Q&A） |
| **D: 无关** | `test-sync-obsidian.md` | 4 | 测试文件 | 跳过 |
| **D: 无关** | `小红书mcp如何搜索.md` | 5 | 搜索说明 | 跳过 |

### 2.2 格式模式识别

**Category A — 结构化 Q&A 格式**:

```markdown
### Q1: 请简述Agent的基本架构组成？⭐⭐⭐⭐⭐（出现7次）

**答案要点:**
（正文内容 或 "要点1:..." 占位符）

**深入解析:**
（可选，详细解答）
```

解析规则：
- 标题以 `### Q数字:` 或 `### 数字.数字` 开头
- 答案在标题和下一个 `###` 之间
- 频次信息从 `⭐` 数量或 `（出现N次）` 提取
- 公司来源从父级 `##` 标题或答案内文本提取

**Category B — 面经叙述格式**:

```markdown
### 1. 字节agent开发实习一面

**作者:** xxx | 👍 874 | ⭐ 1611 | 📅 2026/3/6

1. 如何设计多模型支持架构？
2. 多租户环境下模型切换是否支持热更新？
...
```

解析规则：
- 标题以 `### 数字.` 开头，后跟面经标题
- 元数据行包含作者、点赞、收藏、日期
- 问题以编号列表（`1.` / `1️⃣`）或关键词前缀（`八股:`、`项目:`）呈现
- 公司名从标题文本提取（字节/阿里/美团/快手等）

**答案状态检测规则**:

| 状态 | 特征 | 处理 |
|------|------|------|
| `complete` | 答案正文 > 50 字，含实质内容 | 直接使用 |
| `placeholder` | 含 `要点1:...`、`...` 占位、`（根据实际面经内容补充）` | LLM 生成 |
| `missing` | 无答案块，或答案块为空 | LLM 生成 |

---

## 3. 数据模型

### 3.1 解析后的 Q&A 结构

```typescript
import { z } from 'zod';

const AnswerStatusSchema = z.enum(['complete', 'placeholder', 'missing']);

const ParsedQuestionSchema = z.object({
  id: z.string(),                    // 生成的唯一 ID (hash of question text)
  question: z.string(),              // 问题文本
  answer: z.string().optional(),     // 原始答案（可能为空或占位符）
  answerStatus: AnswerStatusSchema,  // 答案状态
  generatedAnswer: z.string().optional(), // LLM 生成的答案
  sourceFile: z.string(),            // 来源文件名
  category: z.enum(['structured-qa', 'interview-experience', 'learning-notes']),
  company: z.string().optional(),    // 来源公司（字节、阿里等）
  frequency: z.number().optional(),  // 出现频次（从⭐或文本提取）
  tags: z.array(z.string()),         // 标签（ReAct, RAG, Memory 等）
});

type ParsedQuestion = z.infer<typeof ParsedQuestionSchema>;
```

### 3.2 Vector Metadata（导入向量库时）

```typescript
interface ImportedQuestionMetadata {
  questionType: 'agent-architecture' | 'llm-fundamentals' | 'rag' | 'memory' |
                'tool-calling' | 'multi-agent' | 'training' | 'engineering' | 'coding';
  company: string;          // 来源公司，如 "字节" / "阿里" / "通用"
  source: string;           // 来源文件名
  frequency: number;        // 出现频次 (1-10)
  answerSource: 'original' | 'generated'; // 答案是原始的还是 LLM 生成的
}
```

---

## 4. 任务详细拆分

### 4.1 实现 Markdown 解析器 (`src/mastra/lib/md-parser.ts`)

**目标**: 解析三类 Markdown 文件格式，统一提取为 `ParsedQuestion[]`

**子任务**:
- [ ] 4.1.1 实现 `parseStructuredQA(content: string, fileName: string): ParsedQuestion[]`
  - 解析 Category A 文件的 `### Q数字:` 格式
  - 提取问题标题、答案块、频次、公司来源
  - 检测答案状态（complete / placeholder / missing）
- [ ] 4.1.2 实现 `parseInterviewExperience(content: string, fileName: string): ParsedQuestion[]`
  - 解析 Category B 文件的面经叙述格式
  - 从编号列表和关键词前缀提取问题
  - 提取面经元数据（公司、日期）
  - 面经中提取的问题默认 `answerStatus: 'missing'`
- [ ] 4.1.3 实现 `detectAnswerStatus(answerText: string): AnswerStatus`
  - 少于 50 字 → `missing`
  - 含 `要点1:...` 或 `（根据...补充）` → `placeholder`
  - 否则 → `complete`
- [ ] 4.1.4 实现 `parseObsidianFile(filePath: string): ParsedQuestion[]` — 统一入口
  - 读取文件内容
  - 根据文件名/内容特征分类后调用对应解析器
  - 跳过 Category C/D 文件
- [ ] 4.1.5 单元测试：用已知文件内容验证解析结果

**输入**: Markdown 文件路径或内容字符串
**输出**: `ParsedQuestion[]`

---

### 4.2 实现 Obsidian 读取工具 (`src/mastra/tools/obsidian-reader-tool.ts`)

**目标**: Mastra Tool，读取指定目录下所有 `.md` 文件并批量解析

**子任务**:
- [ ] 4.2.1 使用 `createTool()` 定义 `obsidianReaderTool`
  - input schema: `{ dirPath: z.string() }`
  - output: `{ questions: ParsedQuestion[], stats: ParseStats }`
- [ ] 4.2.2 遍历目录，过滤 `.md` 文件，跳过无关文件
- [ ] 4.2.3 调用 `md-parser.ts` 批量解析
- [ ] 4.2.4 输出统计信息（总文件数、解析文件数、提取问题数、各状态分布）

---

### 4.3 实现答案生成工具 (`src/mastra/tools/answer-generator-tool.ts`)

**目标**: Mastra Tool，调用 LLM 为缺失答案的问题生成专业回答

**子任务**:
- [ ] 4.3.1 使用 `createTool()` 定义 `answerGeneratorTool`
  - input: `{ questions: ParsedQuestion[] }` (仅 placeholder/missing 的问题)
  - output: `{ questions: ParsedQuestion[] }` (补全后的问题)
- [ ] 4.3.2 设计 answer generation prompt
  - 角色：AI Agent 领域专家
  - 使用中文回答
  - 输出格式：结构化答案（要点 + 深入解析 + 示例代码/图表）
  - 参考同文件中已有答案的风格和深度
- [ ] 4.3.3 批量处理：每次发送 3-5 个问题给 LLM，控制 token 用量
- [ ] 4.3.4 结果校验：检查生成答案是否非空、长度合理

**LLM prompt 示例**:

```
你是一位资深 AI Agent 技术专家，擅长面试辅导。请为以下面试问题提供详细的中文答案。

要求：
1. 答案应全面、专业，适合大厂面试场景（字节、阿里、美团等）
2. 包含核心要点（3-5 个）和深入解析
3. 适当使用对比表格、架构图（ASCII）、代码示例
4. 答案长度 200-500 字

问题：{question}
来源公司：{company}
```

---

### 4.4 实现去重与合并逻辑

**目标**: 跨文件检测重复问题，合并最优答案

**子任务**:
- [ ] 4.4.1 实现 `deduplicateQuestions(questions: ParsedQuestion[]): ParsedQuestion[]`
  - 第一轮：标题文本归一化后精确匹配（去掉编号、星号、括号注释）
  - 第二轮：使用 FastEmbed 计算问题文本的 embedding，余弦相似度 > 0.85 视为重复
- [ ] 4.4.2 实现合并策略：同一问题多个来源时
  - 优先保留 `complete` 状态的答案
  - 合并 metadata（公司列表、最高频次）
  - 保留最详细的答案版本
- [ ] 4.4.3 输出去重报告（合并前数量 → 合并后数量，重复组列表）

---

### 4.5 实现 Knowledge Builder Agent (`src/mastra/agents/knowledge-builder-agent.ts`)

**目标**: 内部子 Agent，编排 "读取→解析→补全→去重→导入" 全流程

**子任务**:
- [ ] 4.5.1 定义 `knowledgeBuilderAgent`
  - model: `glm-4.5-air`（同 Interview Agent）
  - tools: `obsidianReaderTool`, `answerGeneratorTool`, `vectorUpsertTool`
  - system prompt: 知识库构建专家，负责面试题整理和补全
- [ ] 4.5.2 设计 Agent 交互流程
  - 接收目录路径 → 读取文件 → 报告解析结果 → 补全答案 → 去重 → 导入向量库
  - 返回执行报告（导入数量、生成答案数量、去重数量）
- [ ] 4.5.3 **不在 Mastra Studio 中注册**
  - 不将其加入 `agents` 数组，或标记为 internal
  - 仅通过 `agent.generate()` 或直接函数调用方式使用

**关键设计决策**:

由于这是一个**数据流水线任务**（非对话任务），Knowledge Builder Agent 的核心价值在于：
- 利用 LLM 智能判断文件类型和答案质量
- 利用 LLM 生成缺失答案
- 提供结构化执行报告

实际实现时，可以将其设计为**脚本 + Agent 混合模式**：
- 文件读取、解析、去重等确定性逻辑用纯函数实现
- 答案生成和质量判断委托给 Agent（LLM）

---

### 4.6 实现一键导入脚本 (`src/mastra/scripts/import-obsidian.ts`)

**目标**: CLI 脚本，一键执行 Obsidian 知识库导入

**子任务**:
- [ ] 4.6.1 实现脚本入口
  - 命令行参数：`--dir` (Obsidian 目录路径，默认 `C:\Users\Blaine.Yu\Documents\Notes\Summary\Learning`)
  - 命令行参数：`--wipe` (是否清空旧数据，默认 false)
- [ ] 4.6.2 实现一次性清空逻辑
  - 调用 `vectorStore.deleteIndexByName('interview_questions')`
  - 重新创建索引（同 Phase 1 的 init 逻辑）
  - **仅在 `--wipe` 标志下执行**
- [ ] 4.6.3 调用完整流水线
  1. 读取 + 解析所有文件 → `ParsedQuestion[]`
  2. 答案补全 → 更新 `generatedAnswer` 字段
  3. 去重 → 最终 Q&A 列表
  4. 构建 `{ question, answer, metadata }` 格式
  5. 调用 `chunkAndEmbed()` + `vectorStore.upsert()`
- [ ] 4.6.4 输出执行报告
  ```
  📊 导入报告
  ─────────────
  扫描文件: 10
  有效文件: 7 (跳过 3 个无关文件)
  提取问题: 120
  答案状态: 65 完整 / 30 占位符 / 25 缺失
  LLM 生成: 55 个答案
  去重后: 85 个独立问题
  向量导入: 85 条记录
  执行用时: 3m 25s
  ```

**执行方式**:
```bash
npx tsx src/mastra/scripts/import-obsidian.ts --wipe --dir "C:\Users\Blaine.Yu\Documents\Notes\Summary\Learning"
```

---

### 4.7 注册与集成

**子任务**:
- [ ] 4.7.1 在 `index.ts` 中导入 `knowledgeBuilderAgent`，但**不注册到 Mastra agents 列表**
  - 或使用 Mastra 的 internal agent 机制（如有）
- [ ] 4.7.2 导出为可被 Interview Agent 调用的函数
  - `export async function buildKnowledgeBase(dirPath: string): Promise<BuildReport>`
- [ ] 4.7.3 验证 Interview Agent 可以通过 vectorQueryTool 查询到新导入的数据

---

### 4.8 E2E 测试

**子任务**:
- [ ] 4.8.1 导入测试：执行 `import-obsidian.ts --wipe`，验证导入报告正确
- [ ] 4.8.2 查询测试：向量查询 "ReAct模式的工作原理"，验证返回结果包含新导入的题目
- [ ] 4.8.3 面试测试：用 Interview Agent 进行 3 轮对话，验证提问来自新知识库
- [ ] 4.8.4 答案质量抽检：随机抽取 5 个 LLM 生成的答案，人工评估质量

---

## 5. 技术方案

### 5.1 文件解析策略

```
┌─────────────────────────────────────────────────────┐
│              parseObsidianFile(filePath)              │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. 读取文件内容                                      │
│  2. 判断文件类别:                                     │
│     ┌─────────────────────────────────┐              │
│     │ 文件名含 "八股" + "汇总/完整版"    │→ Category A │
│     │ 文件名含 "八股" (其他)            │→ Category A │
│     │ 文件名含 "面经/面试" + 帖子表格    │→ Category B │
│     │ 文件名 = LangChain / test-*       │→ Category D │
│     └─────────────────────────────────┘              │
│                                                     │
│  3. 调用对应解析器                                    │
│  4. 统一返回 ParsedQuestion[]                         │
└─────────────────────────────────────────────────────┘
```

### 5.2 答案生成流程

```
┌──────────────────────────────────────────────────────┐
│           答案生成流水线                                │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ParsedQuestion[]                                    │
│       │                                              │
│       ├─── status: complete ──→ 直接保留              │
│       │                                              │
│       ├─── status: placeholder ┐                     │
│       │                        ├→ 批量发送 LLM        │
│       └─── status: missing ────┘   (每批 3-5 题)     │
│                                      │               │
│                                      ↓               │
│                              LLM 生成答案             │
│                                      │               │
│                                      ↓               │
│                              校验答案质量              │
│                              (非空、>100字)           │
│                                      │               │
│                                      ↓               │
│                              更新 generatedAnswer     │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 5.3 去重合并策略

```
┌──────────────────────────────────────────────────────┐
│              去重合并流水线                              │
├──────────────────────────────────────────────────────┤
│                                                      │
│  全量 ParsedQuestion[] (可能 120+)                    │
│       │                                              │
│       ↓                                              │
│  第一轮: 标题归一化精确匹配                              │
│  - 移除编号前缀 (Q1:, 1.1, 1️⃣ 等)                    │
│  - 移除频次标记 (⭐, (出现N次))                        │
│  - 移除首尾空白                                       │
│  - 完全相同的标题 → 合并为一组                          │
│       │                                              │
│       ↓                                              │
│  第二轮: 语义相似度匹配                                 │
│  - FastEmbed 编码所有问题文本                          │
│  - 余弦相似度 > 0.85 → 视为重复                       │
│  - 合并到已有组中                                     │
│       │                                              │
│       ↓                                              │
│  合并策略:                                            │
│  - 优先保留 complete 答案                             │
│  - complete > generated > placeholder                │
│  - 取最高 frequency                                  │
│  - 合并 company 列表                                 │
│  - 合并 tags                                         │
│       │                                              │
│       ↓                                              │
│  最终 UniqueQuestion[] (~85 估计)                     │
└──────────────────────────────────────────────────────┘
```

### 5.4 向量导入格式

每个问题导入时，文本内容格式为：

```
## 面试问题

{question}

## 参考答案

{answer 或 generatedAnswer}
```

metadata:
```json
{
  "questionType": "agent-architecture",
  "company": "字节,阿里",
  "source": "AI-Agent-面试八股汇总-完整版.md",
  "frequency": 7,
  "answerSource": "original"
}
```

---

## 6. 预估工作量

| 任务 | 复杂度 | 备注 |
|------|--------|------|
| 4.1 md-parser.ts | ⭐⭐⭐ | 两种格式解析 + 答案检测，正则逻辑较多 |
| 4.2 obsidian-reader-tool | ⭐ | 简单的目录遍历 + 调用解析器 |
| 4.3 answer-generator-tool | ⭐⭐ | Prompt 设计 + 批量调用 + 结果校验 |
| 4.4 去重逻辑 | ⭐⭐⭐ | 语义相似度计算 + 合并策略 |
| 4.5 knowledge-builder-agent | ⭐⭐ | 编排已有逻辑 |
| 4.6 import-obsidian 脚本 | ⭐⭐ | CLI + 清空 + 全流程串联 |
| 4.7 注册集成 | ⭐ | 简单配置 |
| 4.8 E2E 测试 | ⭐⭐ | 需要人工抽检答案质量 |

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| LLM 生成答案质量不均 | 知识库质量下降 | Prompt 精调 + 人工抽检 + 最小长度校验 |
| GLM API 调用频次限制 | 答案生成中断 | 批量处理 + 重试 + 间隔等待 |
| 面经叙述格式不规则 | 问题提取遗漏 | 多种正则fallback + 人工校对样本 |
| 去重过于激进 | 丢失不同角度的好问题 | 相似度阈值从 0.85 开始，可调增 |
| 中文 embedding 效果 | FastEmbed 对中文支持有限 | 测试实际效果，必要时切换中文模型 |

---

## 8. 验收标准

- [x] 成功解析 ≥ 7 个有效文件 → ✅ 7 个有效文件（3 个跳过）
- [x] 提取问题总数 ≥ 80 → ✅ 348 个问题提取
- [x] 所有 placeholder/missing 问题均获得 LLM 生成答案 → ✅ 156/156 成功（0 失败）
- [x] 去重后独立问题 ≥ 60 → ✅ 201 个独立问题
- [x] 向量库查询返回相关结果 → ✅ 中文语义查询成功
- [x] Interview Agent 可正常使用新知识库进行面试对话 → ✅ E2E 中文面试测试通过
- [x] 旧知识库数据已被清空 → ✅ --wipe 标志执行成功

---

## 9. 实际执行结果

### 导入报告

```
═══════════════════════════════════════════
  📊 Import Report
═══════════════════════════════════════════
  Scanned files:     10
  Extracted questions: 348
  After dedup:       201  (title: 348→229, semantic: 229→201)
  LLM generated:     156  (100% success)
  LLM failed:        0
  Imported to DB:    201
  Elapsed:           2256.5s (~37 min)
═══════════════════════════════════════════
```

### 设计决策变更

| 原计划 | 实际 | 原因 |
|--------|------|------|
| Knowledge Builder Agent | 脚本流水线 (`import-obsidian.ts`) | 批量数据管道不适合对话式 Agent 模式 |
| 三类文件解析器 | 两类（structured-qa + interview-experience） | LangChain.md 等学习笔记直接跳过 |
| 语义相似度阈值 0.85 | 0.97 | all-MiniLM-L6-v2 对中文语义理解弱，低阈值导致误合并 |

### 新增文件

| 文件 | 用途 |
|------|------|
| `src/mastra/lib/md-parser.ts` | Markdown 解析器（结构化 Q&A + 面经叙述） |
| `src/mastra/lib/dedup.ts` | 标题归一化 + 语义相似度去重 |
| `src/mastra/tools/obsidian-reader-tool.ts` | Mastra Tool: 批量读取 Obsidian 目录 |
| `src/mastra/tools/answer-generator-tool.ts` | Mastra Tool: LLM 答案生成 |
| `src/mastra/scripts/import-obsidian.ts` | 一键导入脚本（含 --wipe, --skip-generate） |
| `src/mastra/scripts/test-obsidian-import.ts` | Phase 4 E2E 验证测试 |
| `src/mastra/scripts/test-parser.ts` | 解析器 + 去重调试脚本 |

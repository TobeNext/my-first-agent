# Interview State Machine Plan

## 目标

在不改变现有前端、BFF、Mastra 对外交互方式和已有功能边界的前提下，为当前 interview-agent 增加一套显式的多轮对话状态机，重点覆盖“第一轮：专业技能面试”的问答流程管理。

本次计划要解决的问题：

- 专业技能面试不再是当前的少量问题顺序问答，而是扩展为 6-8 个专业技能点的逐点深挖
- 每个技能点下支持 3-4 次追问，用于判断候选人对该点的理解深度
- 当用户中途输入其他内容时，系统只能在有限次数内偏航回应，之后必须继续当前问题，而不是直接进入下一个问题
- 系统需要结构化记录当前题目状态、追问状态、用户回答状态、每次回答评分、漏答点、错误点等过程信息

---

## 范围约束

### In Scope

- 为 interview-agent 设计并实现显式状态机
- 把“专业技能面试”改造成 6-8 个技能点节点的状态化流程
- 为每个节点补充 3-4 次追问的状态记录与转移规则
- 为偏题输入增加“有限次响应后回到当前问题”的恢复机制
- 为每次用户回答增加结构化评分与状态记录
- 保持当前“项目经历面试”“回答纠正开关”“轮次跳过设置”“最终总结报告”等现有功能继续可用

### Out Of Scope

- 不在本阶段修改前端页面交互形态
- 不在本阶段修改 BFF 请求协议或 SSE 流格式
- 不在本阶段新增数据库持久化；状态先维持在线程级会话内
- 不在本阶段重做简历解析能力，仅复用现有 resumeParserTool 输出

---

## 现状与缺口

当前实现特征：

- `src/mastra/agents/interview-agent.ts` 使用 Markdown Working Memory 模板记录少量面试状态
- 当前专业技能轮只按问题列表逐题推进，没有真正的节点级状态机
- 当前追问上限为 2，且主要依赖 prompt 描述，不是显式状态流转
- 当前没有对“用户临时问别的问题”建立单独的偏航状态与回归策略
- 当前评分偏向题目完成后的总结，没有细化到“每次回答/每次追问回答”的结构化记录

这意味着：

- LLM 虽然可以“看起来像在管理流程”，但对复杂多轮深挖的稳定性不够
- 当用户偏题时，流程是否回到当前题目主要依赖 prompt 遵守度，缺少可验证状态
- 后续如果要做可视化、调试、复盘或评分统计，当前状态数据粒度不够

---

## 总体设计原则

1. 保持现有入口不变

- 前端仍通过 BFF 请求现有 `interview-agent`
- BFF 仍透传 threadId 和消息流，不新增额外接口契约

1. 状态机先于 prompt

- 面试流程推进尽量由结构化状态决定
- LLM 负责“如何提问、如何追问、如何表达反馈”，而不是单独负责“流程是否跳转”

1. 结构化状态优先于 Markdown 自由文本

- 本次实施建议把当前 Working Memory 从松散 Markdown 模板，升级为更结构化的状态表示
- 具体采用 Mastra 的哪种 Memory API 形态，在实施前必须再次核对当前版本文档，不凭经验直接写

1. 先增强专业技能轮，再复用到其他轮次

- 第一阶段只把专业技能轮升级为 6-8 节点状态机
- 项目经历轮暂时保留当前行为模式，但状态模型要设计成可复用，避免以后再推倒重来

---

## 目标状态机结构

状态机采用“两层结构”：

- 第一层：整场面试的 Session State Machine
- 第二层：专业技能轮内部的 Topic Node State Machine

### 第一层：Session State Machine

建议状态：

- `intro`：开场、读取 setup、解析简历、生成技能点计划
- `professional-skills-round`：专业技能轮进行中
- `project-experience-round`：项目经历轮进行中
- `wrap-up`：生成最终报告
- `completed`：整场面试结束

核心转移：

- `intro -> professional-skills-round`
- `intro -> project-experience-round`：当第一轮被跳过时
- `professional-skills-round -> project-experience-round`
- `professional-skills-round -> wrap-up`：当第二轮被跳过时
- `project-experience-round -> wrap-up`
- `wrap-up -> completed`

### 第二层：专业技能节点状态机

专业技能轮在初始化时一次性规划 6-8 个技能点节点，每个节点代表一个专业能力主题，例如：

- 分布式系统
- Agent 架构设计
- RAG 检索链路
- Prompt Engineering
- 工程化与可观测性
- 性能优化
- 安全与权限
- 测试与评估

每个节点的建议状态：

- `pending`：尚未开始
- `asking-main-question`：正在提出主问题
- `awaiting-main-answer`：等待用户回答主问题
- `asking-follow-up`：正在提出追问
- `awaiting-follow-up-answer`：等待用户回答追问
- `detour-handling`：用户偏题，系统在有限次数内进行偏航响应
- `evaluating`：对当前节点进行阶段性评分与总结
- `completed`：当前节点完成
- `skipped`：用户明确跳过当前节点

---

## 每个技能节点的固定配额

### 节点数量

- 专业技能轮固定规划 `6-8` 个节点
- 默认值建议为 `6`
- 当简历专业技能内容较丰富且知识库命中质量较高时，可扩展到 `8`

### 追问数量

- 每个节点固定允许 `3-4` 次追问
- 默认目标值建议为 `3`
- 当用户回答质量高、信息量足够时，可以提前结束追问，但状态中仍要记录“提前收束”原因

### 偏航响应次数

- 每个节点单独维护 `detourResponseCount`
- 默认最多允许 `2` 次偏航响应
- 达到上限后，只允许短回应并立刻拉回当前问题，不得进入下一题

---

## 用户输入分类规则

每次用户消息都要先分类，再决定状态转移。建议分类如下：

- `direct-answer`：直接回答当前问题
- `partial-answer`：部分回答，但明显不完整
- `deep-answer`：回答较完整，可以少追问或直接进入评分
- `off-topic`：讨论了别的话题，但并未请求结束或跳过
- `clarification-request`：请求解释题意或追问原因
- `skip-request`：要求跳过当前题目
- `stop-request`：要求结束整场面试
- `meta-question`：询问流程、规则、评分方式等元问题

说明：

- `meta-question` 不等于可以跳题，默认归入偏航处理
- `off-topic` 和 `meta-question` 在有限次回应后，都必须回到当前节点
- 只有 `skip-request` 或 `stop-request` 才允许改变当前题目的主流程命运

---

## 偏题恢复机制

这是本次状态机设计的重点之一。

### 目标行为

当用户在某个技能点上输入其他内容时：

1. 系统可以简要回应用户内容
2. 但这种回应必须受到次数限制
3. 限制次数内，每次回应结尾都要显式拉回当前问题
4. 超过限制后，不再展开新话题，直接重述当前问题或当前追问
5. 在偏题期间，不能把节点误判为已完成，也不能跳到下一个技能点

### 状态转移建议

- `awaiting-main-answer + off-topic -> detour-handling`
- `awaiting-follow-up-answer + off-topic -> detour-handling`
- `detour-handling + detour count < max -> awaiting-same-question`
- `detour-handling + detour count >= max -> force-return-to-current-question`

### 响应策略

- 第 1 次偏题：允许简短回应 + 桥接回当前问题
- 第 2 次偏题：进一步压缩回应长度 + 明确提醒先完成当前题目
- 第 3 次及以后：不再展开偏题内容，只确认收到并直接重述当前问题

---

## 评分与状态记录模型

本次不是只记录“每题总分”，而是要记录“每次回答”的状态与评分。

### Session 级状态

建议记录：

- 面试线程 ID
- 目标岗位
- 当前轮次
- 当前技能点 ID
- 当前问题 ID
- 当前追问序号
- 当前面试阶段状态
- 已完成节点数
- 是否触发最终总结

### Round 级状态

建议记录：

- 轮次类型：`professional-skills` / `project-experience`
- 轮次状态：`pending` / `in-progress` / `completed` / `skipped`
- 计划节点数
- 已完成节点数
- 当前活动节点 ID
- 节点顺序列表

### Topic Node 级状态

建议记录：

- 节点 ID
- 技能点名称
- 节点来源：简历、知识库、方向设置、LLM 规划
- 主问题内容
- 节点状态
- 追问列表
- 回答尝试列表
- 偏题次数
- 当前是否允许继续追问
- 节点评分汇总
- 节点结论：强项、薄弱点、建议

### Follow-up 级状态

建议记录：

- 追问 ID
- 追问序号
- 追问意图：验证广度、验证深度、验证准确性、验证实战经验
- 追问问题内容
- 状态：`pending` / `asked` / `answered` / `abandoned`
- 关联回答 ID

### Answer Attempt 级状态

建议记录：

- 回答 ID
- 回答对应的节点 ID / 追问 ID
- 用户原始消息
- 输入分类结果
- 是否偏题
- 是否有效回答当前问题
- 评分拆解
- 漏答点
- 错误点
- 置信度备注
- 时间戳

### 评分维度建议

每次回答评分建议拆为以下维度：

- `relevance`：是否回答到了当前问题
- `accuracy`：技术表述是否正确
- `depth`：是否体现原理、取舍、边界条件
- `specificity`：是否给出具体案例、细节或数据
- `clarity`：表达是否清晰、有结构

建议权重：

- relevance: 25%
- accuracy: 25%
- depth: 25%
- specificity: 15%
- clarity: 10%

最终得到：

- 单次回答分数
- 节点累计分数
- 整轮平均分
- 最终面试总分

---

## 建议的数据结构

以下是实现阶段建议落地的结构方向，具体字段名可以在编码时微调：

```ts
interface InterviewSessionState {
  version: number;
  threadId: string;
  targetRole: string;
  phase:
    | 'intro'
    | 'professional-skills-round'
    | 'project-experience-round'
    | 'wrap-up'
    | 'completed';
  activeRoundId: string | null;
  rounds: InterviewRoundState[];
  finalReportReady: boolean;
}

interface InterviewRoundState {
  id: string;
  type: 'professional-skills' | 'project-experience';
  status: 'pending' | 'in-progress' | 'completed' | 'skipped';
  plannedNodeCount: number;
  completedNodeCount: number;
  activeNodeId: string | null;
  nodeOrder: string[];
  nodes: InterviewTopicNodeState[];
}

interface InterviewTopicNodeState {
  id: string;
  topic: string;
  source: 'resume' | 'knowledge-base' | 'setup' | 'generated';
  mainQuestion: string;
  status:
    | 'pending'
    | 'asking-main-question'
    | 'awaiting-main-answer'
    | 'asking-follow-up'
    | 'awaiting-follow-up-answer'
    | 'detour-handling'
    | 'evaluating'
    | 'completed'
    | 'skipped';
  followUps: FollowUpState[];
  answerAttempts: AnswerAttemptState[];
  detourResponseCount: number;
  aggregatedScore: number | null;
  summary: {
    strengths: string[];
    weaknesses: string[];
    missingPoints: string[];
    improvementAdvice: string[];
  } | null;
}

interface FollowUpState {
  id: string;
  index: number;
  intent: 'breadth' | 'depth' | 'accuracy' | 'experience';
  question: string;
  status: 'pending' | 'asked' | 'answered' | 'abandoned';
  linkedAnswerId: string | null;
}

interface AnswerAttemptState {
  id: string;
  targetType: 'main-question' | 'follow-up';
  targetId: string;
  userMessage: string;
  classification:
    | 'direct-answer'
    | 'partial-answer'
    | 'deep-answer'
    | 'off-topic'
    | 'clarification-request'
    | 'skip-request'
    | 'stop-request'
    | 'meta-question';
  score: {
    relevance: number;
    accuracy: number;
    depth: number;
    specificity: number;
    clarity: number;
    weightedTotal: number;
  } | null;
  missingPoints: string[];
  incorrectPoints: string[];
  isDetour: boolean;
  createdAt: string;
}
```

---

## 实现方案拆分

### Phase 0：Mastra API 核对与技术预研

目标：先确认当前仓库实际安装的 Mastra 版本支持怎样的 Memory、Agent、Tool 接法，避免后续实现建立在过时 API 假设上。

任务：

- 核对当前 `package.json` 与 `node_modules` 中的 Mastra 版本和类型定义
- 对 Memory 的可选实现方式做一次最小 spike，确认是否能承载结构化状态
- 明确“状态存在哪里、由谁读写、以何种格式序列化”的最终接线方案
- 输出一份实现约束说明，作为正式编码前置结论

完成标准：

- 已确认可用的 Memory 方案与 Agent 接入方式
- 已排除明显依赖旧文档或旧 API 的实现路径
- 正式编码阶段不再凭经验猜测 Mastra 用法

### Phase A：引入显式状态模型

目标：先把“状态长什么样”从 prompt 文本中抽离出来。

任务：

- 新增 interview state schema / types
- 新增纯函数 reducer 或 transition helpers
- 定义所有合法状态转移和非法转移保护
- 把当前 Working Memory 模板迁移到更结构化的状态表示
- 明确区分“活动节点完整状态”和“已完成节点压缩摘要”两种存储层级
- 为状态对象增加版本号与兼容字段，避免后续迭代时直接破坏老会话

建议文件：

- `src/mastra/lib/interview-state-machine.ts`
- `src/mastra/lib/interview-state-machine-schema.ts`
- `src/mastra/lib/interview-state-machine-reducer.ts`

### Phase B：专业技能轮节点规划

目标：在开场阶段生成 6-8 个技能点节点，而不是边聊边临时决定下一题。

任务：

- 基于选定方向、简历专业技能、知识库结果规划技能点列表
- 为每个技能点生成主问题
- 为每个技能点预生成 3-4 个候选追问意图或追问槽位
- 记录节点顺序和优先级
- 控制初始化状态体积，节点初始化阶段只生成主问题与追问槽位，不一次性生成所有追问全文

建议：

- 节点规划优先复用现有 `resumeParserTool` 和 `interviewQuestionTool`
- 若知识库命中不足，再用 resume-grounded fallback question 补足节点

### Phase C：用户回答分类与偏航恢复

目标：让“用户答题、偏题、请求跳过、请求结束”都进入显式状态流转。

任务：

- 增加用户输入分类步骤
- 新增偏航计数与回归逻辑
- 确保偏题不会错误推进到下一题
- 保证同一节点内可连续追问 3-4 次
- 建立“规则优先、模型补充”的分类链路，先识别 stop/skip/clarification 等强信号输入
- 对模型输出的分类结果做 schema 校验和兜底回退

建议实现方式：

- 优先使用纯逻辑 + LLM 辅助判断的混合模式
- 如果分类高度依赖模型输出，则必须对输出做 Zod 校验

落地约束：

- `stop-request`、`skip-request`、明显的 `clarification-request` 优先通过规则识别，不完全交给模型判断
- 模型只能输出受限枚举值；出现非法值时回退到 `partial-answer` 或 `off-topic`
- 偏航恢复的状态推进必须由 reducer 控制，不能由 prompt 自主决定是否切题

### Phase D：逐次评分与节点汇总

目标：把每次回答都沉淀为结构化评分记录。

任务：

- 为每次主回答/追问回答生成评分拆解
- 记录漏答点和错误点
- 汇总为节点级结论
- 最终再汇总成整场报告
- 为评分输出增加 schema 校验、分值范围校验和默认值策略
- 建立一组固定样例用于校准评分维度，避免模型漂移导致分数不稳定

落地约束：

- 评分模块输出必须是结构化对象，不能直接把自然语言段落当评分结果消费
- 如果评分结果不合法，则降级为“仅记录缺失点和错误点，不更新分数”
- 节点汇总优先基于结构化回答记录生成，而不是重新让模型自由回忆整段对话

### Phase E：最小改动接入现有 Agent

目标：保持对外能力不变，只替换内部流程控制方式。

任务：

- 更新 `src/mastra/agents/interview-agent.ts`
- 保留当前 setup 输入格式、跳过设置、逐题纠错设置
- 保留当前 BFF 和前端调用链
- 保留现有最终总结输出能力，但输出所依赖的数据改为读取结构化状态
- prompt 中只保留“如何表达”和“如何组织提问”的职责，不再直接承担核心流转判断
- 当前轮活动节点以完整状态注入，上一个已完成节点只注入压缩摘要，控制上下文负担

### Phase F：状态压缩与上下文预算控制

目标：在 6-8 个节点、3-4 次追问和逐次评分的前提下，避免状态膨胀导致上下文负担过高。

任务：

- 设计 completed node 的压缩摘要结构，只保留节点结论、累计分数和必要证据
- 限制 working memory 中保留的原始回答明细数量，超出阈值后压缩到 summary
- 将“当前活动节点详细状态”和“历史节点摘要状态”分开维护
- 明确用户可见输出与内部审计状态的边界，避免把全部内部细节回灌给 prompt

完成标准：

- 当前活动节点保持完整信息
- 已完成节点能被压缩成可追溯摘要
- 多节点长对话下，状态仍可稳定读写，不出现明显上下文失控

---

## 与现有功能的兼容策略

为了满足“其他功能不变”，实施时需要明确以下兼容约束：

1. 前端页面不改

- 仍然使用当前 setup 面板、方向选择、轮次跳过和逐题纠错开关
- 不要求前端额外展示状态机细节

1. BFF 接口不改

- 仍然通过现有 `/api/agents/interview/setup` 和 stream chat 接口工作
- 不新增前端必须传入的字段

1. 项目经历轮先不重构

- 保留当前第二轮项目经历面试的整体行为
- 但底层状态模型要可容纳第二轮未来迁移到相同状态机

1. 回答纠错开关继续生效

- 如果开启，则节点完成后继续输出纠错摘要
- 如果关闭，则评分与漏答点只记录在状态中，不即时展示

1. 轮次跳过继续生效

- 跳过第一轮时，状态机直接从 `intro` 进入 `project-experience-round`
- 跳过第二轮时，第一轮完成后直接进入 `wrap-up`

---

## 测试计划

### 单元测试

重点覆盖：

- 状态初始化是否生成 6-8 个技能点节点
- 每个节点是否具备 3-4 个追问槽位
- `direct-answer`、`partial-answer`、`off-topic`、`skip-request`、`stop-request` 的状态转移是否正确
- 偏题计数达到上限后是否仍然停留在当前节点
- 节点完成后是否正确切换到下一个节点
- 非法状态转移是否被 reducer 显式拦截
- completed node 压缩后是否仍保留必要评分摘要和结论
- 分类输出非法值时是否触发兜底回退
- 评分输出超范围或缺字段时是否被拒绝写入

### 集成测试

重点覆盖：

- setup -> intro -> 第一轮开始 的完整路径
- 第一轮连续多节点推进
- 第一轮内多次追问
- 偏题后返回原问题
- 提前跳过题目
- 第一轮完成后进入第二轮或 wrap-up
- 长对话下 completed node 是否按预期压缩，而不是无限保留完整明细
- prompt 是否只消费状态结果，不会绕过 reducer 自行切换到下一个节点
- Mastra Memory 接线是否能稳定保存和恢复结构化状态

### E2E 测试

建议扩展当前脚本：

- `src/mastra/scripts/test-interview.ts`
- 新增至少 3 类剧本：
  - 正常深答型
  - 多次偏题型
  - 中途要求结束型
- 增加 2 类回归剧本：
  - 分类边界型：澄清请求、元问题、跳题请求混合出现
  - 长上下文型：至少跨 4 个技能点，验证状态压缩后仍能继续追问

### 技术预研验证

在正式开发前增加一次小范围验证：

- 验证当前 Mastra 版本下的 Memory 读写方式是否满足结构化状态要求
- 验证 reducer + memory + agent prompt 的最小闭环是否能运行
- 如果 spike 结果显示当前 Memory 方案不适合承载完整状态，则在编码前调整设计，不带着错误假设进入实现阶段

---

## 验收标准

满足以下条件时，本计划对应功能可视为完成：

- 专业技能轮稳定生成 6-8 个技能点节点
- 每个节点支持 3-4 次追问或达到提前收束条件
- 用户在节点中输入其他内容时，系统会在有限次数内回应后回到当前问题
- 偏题不会导致错误切题或误进入下一节点
- 系统能记录当前问题状态、追问状态、用户回答状态、每次评分、漏答点和错误点
- 最终总结报告能基于结构化状态生成，而不是只依赖临时上下文
- 前端和 BFF 无需调整协议即可继续联调
- 核心状态推进由 reducer / transition helpers 控制，而不是仅靠 prompt 约束
- 已完成节点会被压缩为摘要，不会无限累积完整明细导致上下文失控
- 分类与评分输出都经过 schema 校验，并具备明确兜底策略
- 实现方案已经过当前 Mastra 版本的文档核对和最小技术预研验证

---

## 风险应对方案

### 风险 1：仍然过度依赖 Prompt

如果只是继续往 system prompt 里加规则，而不把状态转移抽为显式结构，最终稳定性不会显著改善。

应对动作：

- 以 reducer / transition helpers 作为唯一合法状态推进入口
- prompt 只负责生成自然语言问题、追问、纠错和总结，不直接决定切题
- 为每个关键跳转增加单元测试，例如“偏题后仍停留当前节点”“追问上限后进入 evaluating”
- 在集成测试中校验 agent 输出虽可变化，但状态结果必须一致

计划调整：

- Phase A 明确增加非法状态转移保护
- Phase E 明确削减 prompt 的流程控制职责

### 风险 2：状态结构过大，超出上下文负担

6-8 个节点、每节点 3-4 次追问、每次回答都记录明细，状态会明显膨胀。

应对动作：

- 设计双层状态保留策略：活动节点保留完整明细，已完成节点压缩为摘要
- completed node 只保留累计评分、结论、关键证据和必要引用，不保留所有原始明细
- 给 working memory 设定状态预算，超出阈值时触发压缩逻辑
- 区分内部审计状态与 prompt 消费状态，避免把全部内部记录注入模型上下文

计划调整：

- 新增 Phase F 专门处理状态压缩与上下文预算控制
- 测试计划增加长对话压缩回归

### 风险 3：分类与评分结果不稳定

回答分类和评分可能随模型波动。

应对动作：

- 对分类和评分都采用受限 schema 输出，不接受自由文本直接进入状态
- 强信号输入先走规则识别，例如 stop、skip、clarification，再让模型处理灰区输入
- 为非法输出、缺字段输出、超范围分值定义统一兜底策略
- 建立固定测试样例集，对分类和评分做回归校准，避免模型升级后行为漂移

计划调整：

- Phase C 增加规则优先的分类链路
- Phase D 增加评分校验与降级机制
- 单元测试和 E2E 增加分类边界与评分异常场景

### 风险 4：Mastra 当前版本 API 差异

Memory、Agent 或 tool 集成方式可能与历史经验不一致。

应对动作：

- 在正式开发前执行一次 Phase 0 技术预研，确认 Memory 和 Agent 的当前可用接法
- 以当前仓库依赖与本地类型定义作为第一事实来源，不使用过时经验直接编码
- 先打通最小闭环 spike，再开展大规模状态机实现
- 如果预研结果与本计划假设冲突，先更新计划再编码，不带病推进

计划调整：

- 在 Phase A 之前新增 Phase 0：Mastra API 核对与技术预研
- 测试计划新增“技术预研验证”一节，要求在正式开发前完成

---

## 推荐实施顺序

1. 先做状态 schema 与 reducer，不改 prompt 细节
2. 再做专业技能轮的 6-8 节点规划
3. 再接入用户输入分类与偏航恢复
4. 再补逐次评分与节点汇总
5. 最后替换 interview-agent 内部流程，并跑 E2E 回归

---

## 本计划对应的代码落点

预计主要影响：

- `src/mastra/agents/interview-agent.ts`
- `src/mastra/lib/` 下新增 interview state machine 相关文件
- `src/mastra/scripts/test-interview.ts`
- 如有必要，补充 `src/mastra/scorers/` 下的 interview answer scorer

预计不需要修改：

- `frontend/src/views/AgentChatView.vue`
- `frontend/src/services/bff-api.ts`
- `bff/src/modules/agent/agent.service.ts`

---

## 结论

这次改动的本质不是“多加几条 prompt 规则”，而是把当前 interview-agent 从“提示词驱动的流程”升级为“状态机驱动的流程”。

优先级最高的设计点有三个：

- 专业技能轮预规划 6-8 个技能点节点
- 每个节点显式维护 3-4 次追问与回答状态
- 偏题时有限次响应后强制回到当前问题

只要这三个点落地，并且评分与回答状态变成结构化记录，后续无论是做更稳定的面试流程、可视化调试、面试复盘还是长期评估，都会容易很多。

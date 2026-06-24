# 2026-06-23 Interview Log Error Analysis And Fix Plan

## 背景

本计划基于一次完整本地测试日志：

- 日志线程：`fcf70d96-36db-4db5-b4e1-565d6f47551f`
- Python runtime：`http://0.0.0.0:8011`
- 主要时间段：`2026-06-23 14:00:09` 到 `2026-06-23 14:10:18`
- 现象重点：追问里出现“你提到/你刚才提到”的假设，但候选人反馈“这不是我的回答”“我没有提到”；同时日志持续出现 DeepSeek structured output 400 和 OpenTelemetry collector 连接失败。

## 结论摘要

本轮日志里有三类问题：

1. **LLM structured output 不兼容 DeepSeek 当前接口**
   - `follow-up-question-generation` 和 `report-generation` 都先调用 `with_structured_output(...)`。
   - DeepSeek 返回 `400 Bad Request`：`This response_format type is unavailable now`。
   - 系统随后用普通文本 JSON prompt 再调用一次模型并成功解析，所以功能没有中断，但每次真实 LLM 调用都会多一次失败请求、一次错误日志和额外延迟。

2. **OpenTelemetry 默认尝试导出到本地 `localhost:4318`，但 collector 没启动**
   - 日志持续出现 `HTTPConnectionPool(host='localhost', port=4318)` 和 `WinError 10061`。
   - 这是观测链路配置问题，不是面试业务逻辑失败。
   - 影响是日志噪音、导出重试和少量性能损耗。

3. **“兜底问题 + LLM 问题混合感”的根因是追问上下文和实时评估策略不一致**
   - 实时答题推进使用 `build_rule_evaluation()`，普通回答会默认归类为 `direct-answer`，score 为 7，follow-up focus 默认为当前 topic。
   - `should_keep_following_up()` 对专业技能轮有 `guaranteed_follow_ups = 2`，前两个追问即使没有缺口也会继续问。
   - `build_dedicated_follow_up_question_prompt()` 的参数里有 `user_message`，但 prompt 实际没有把候选人当前回答或当前节点对话放进去；同时 prompt 又要求 LLM “stays on the same topic as the current question and the candidate answer” 和 “Prefer asking about the specific concept the candidate actually mentioned”。
   - 结果是 LLM 只能根据当前题目、topic、简历摘要、历史追问、follow-up focus 生成追问，却被要求像是基于候选人回答生成。模型会把题目/简历/RAG 中的内容误写成“你提到”。
   - 当 structured output 失败且普通 JSON 调用成功时，日志上表现为“先有 structured-output 错误，再有 LLM 追问输出”；当 LLM 追问为空时，`build_follow_up_question()` 会使用本地兜底模板，例如“请详细说说你提到的...”。这两条路径的措辞都带“你提到”，所以用户感知上像“兜底问题和 LLM 问题结合在一起”。

## 日志证据

### DeepSeek structured output 失败

- `14:00:48`：`follow-up-question-generation` structured output 请求返回 `400 Bad Request`。
- 错误内容：`This response_format type is unavailable now`。
- 随后同一 prompt 普通调用返回 `200 OK`，并输出追问：
  `你在回答中提到单 Agent 和 Multi-Agent 架构...`
- `14:01:42`：第二次追问重复同类 structured output 400，随后普通调用成功。
- `14:09:24`：`report-generation` structured output 同类 400，随后普通调用成功生成报告。

### OpenTelemetry collector 未启动

- 从 `14:00:09` 到 `14:10:18` 多次出现：
  `Failed to establish a new connection: [WinError 10061]`
- 目标固定是 `localhost:4318/v1/traces`。
- 这说明 SDK 已启用，但本地 OTLP HTTP collector 没有监听 4318。

### 追问上下文缺少候选人回答

代码位置：

- `../my-first-agent-langgraph/src/app/domain/follow_up_generation.py`
- `build_dedicated_follow_up_question_prompt(...)` 接收 `user_message`，但 prompt lines 没有插入 `user_message`。
- 同文件里存在 `_build_node_conversation_record(...)`，可以构造当前节点对话记录，但当前没有被 prompt 使用。

效果：

- prompt 说要基于 candidate answer，但实际输入里没有 candidate answer。
- LLM 只看到 `Current question`、`Topic`、简历和历史追问。
- 因此它会把“当前题目包含的概念”或“简历里的技能”当成候选人刚刚提到的内容。

### 实时评估过于宽松

代码位置：

- `../my-first-agent-langgraph/src/app/domain/interview_state_machine.py`
- `build_rule_evaluation()`：`classify_by_rules(stored_message) or "direct-answer"`。
- `followUpFocus=[_active_topic(state) or "当前问题"]`。
- `should_keep_following_up()`：专业技能轮前两个追问固定继续。

效果：

- “没有用过”“这不是我的回答”“我没有提到”“这么多追问吗”这类回答没有被识别为能力边界、纠正请求或元问题。
- 系统仍然可能继续生成下一轮深挖追问。
- 最终报告会根据这些低信息量回答打低分，但实时追问阶段没有提前收敛或换问法。

## 修复目标

1. DeepSeek/openai-compatible provider 下，不再盲目使用不兼容的 structured output `response_format`。
2. 追问生成必须显式基于候选人当前回答和当前节点对话，不允许把简历、题目、RAG 参考内容伪装成候选人“提到”的内容。
3. 兜底追问模板必须使用中性措辞，只有在真实回答中抽取到概念时才说“你提到”。
4. 实时规则评估要识别否定经验、纠正模型假设、抱怨追问数量等场景，减少无效深挖。
5. 本地开发时 OpenTelemetry 要么一键启动 collector，要么默认关闭 OTLP 导出，避免日志污染。

## 建议实施步骤

### P0-1：按 provider 配置 structured output 策略

改动位置：

- `../my-first-agent-langgraph/src/app/integrations/models.py`
- `../my-first-agent-langgraph/src/app/config.py`
- `../my-first-agent-langgraph/src/app/domain/follow_up_generation.py`
- `../my-first-agent-langgraph/src/app/domain/report_generation.py`
- `../my-first-agent-langgraph/src/app/domain/answer_evaluation_runtime.py`

方案：

1. 新增配置，例如 `MODEL_STRUCTURED_OUTPUT_MODE`：
   - `auto`：默认，已知不支持的 provider/model 走 raw JSON。
   - `native`：强制 `with_structured_output`。
   - `raw-json`：始终普通 invoke 后解析 JSON。
2. 对 `MODEL_PROVIDER=deepseek` 或 `MODEL_BASE_URL=https://api.deepseek.com` 默认使用 `raw-json`。
3. 在 `follow_up_generation`、`report_generation`、`answer_evaluation_runtime` 里复用一个 helper：
   - 支持 native structured output 时用 `with_structured_output`。
   - 不支持时直接 `invoke(prompt)` + `_parse_raw_model_json(...)`。
4. 如果 native structured output 失败并命中 `This response_format type is unavailable now`，本进程内记忆该 provider/model 不支持，后续不要继续试 native。

验收标准：

- DeepSeek 下不再出现每次请求先 400 再 200。
- follow-up/report/evaluation 仍能解析 JSON。
- OpenAI 原生 provider 仍可使用 native structured output。

### P0-2：追问 prompt 加入真实候选人回答和节点对话

改动位置：

- `../my-first-agent-langgraph/src/app/domain/follow_up_generation.py`

方案：

1. 在 `build_dedicated_follow_up_question_prompt(...)` 中加入：
   - `Current candidate answer: {user_message}`
   - `Current node conversation:`，复用已有 `_build_node_conversation_record(...)`。
2. 修改 prompt 约束：
   - 只有当某概念出现在 `Current candidate answer` 或当前节点历史 candidate answer 中，才允许使用“你提到/you mentioned”。
   - 如果候选人明确说没用过、没提到、不是自己的回答，追问应该先澄清或改为“那请你从理解层面说明...”，不能继续假设候选人有相关实践。
3. 减少简历字段在追问 prompt 中的权重：
   - 简历/JD 只能用于选题背景，不能作为“候选人当前回答事实”。
   - 明确要求不要把 resume/JD 里的内容写成“你刚才提到”。

验收标准：

- 给定回答“我没有提到持久化 Memory”，下一问不能出现“在你提到的这个案例中...”。
- 给定回答“没有用过虚拟线程”，下一问不能假设“你提到使用虚拟线程管理 Agent 生命周期”。
- 给定有效回答里确实出现 “Tool Calling”，下一问才可以说“你提到 Tool Calling”。

### P0-3：让本地兜底追问模板变中性

改动位置：

- `../my-first-agent-langgraph/src/app/domain/interview_state_machine.py`

方案：

1. 将 `build_follow_up_question()` 非 flow-test 兜底文案从：
   - `请详细说说你提到的“{focus}”...`
   改为：
   - `请围绕“{focus}”再展开一点，说明你的理解、依据或实际接触情况。`
2. 第二问从：
   - `请继续围绕“{focus}”说明它的具体应用场景...`
   改为：
   - `如果你有相关实践，请结合场景说明；如果没有，请从设计思路和风险边界说明。`
3. 英文模板同样去掉 `you mentioned`，改为 neutral wording。

验收标准：

- LLM 失败、返回空、重复问题被拒时，兜底追问不会误称候选人“提到”某概念。

### P1-1：增强实时规则评估的拒答/纠正/经验边界识别

改动位置：

- `../my-first-agent-langgraph/src/app/domain/interview_state_machine.py`

方案：

1. 扩展 `classify_by_rules()` 或新增 helper 识别：
   - `没有用过`、`没做过`、`不了解`、`不熟悉`、`没有实践`
   - `我没有提到`、`这不是我的回答`、`你误解了`
   - `这么多追问吗`、`为什么一直追问`
2. 对“纠正模型假设”类回答：
   - 归为 `clarification-request` 或新增内部语义标记。
   - assistant reply 应先承认并收束：`明白，我不假设你有这段实践。那请你从理解层面回答...`
3. 对“没有经验”类回答：
   - 可以记录为低 evidence，但下一问应切换为理解型或换到下一个主问题，避免继续追问不存在的实践。
4. 对“追问数量抱怨”类回答：
   - 归为 `meta-question`，解释当前追问策略，并可提示“回答完这一问后进入下一题”或直接进入下一题。

验收标准：

- 输入“没有用过虚拟线程”不会生成“你提到使用虚拟线程...”。
- 输入“我没有提到这个”会先澄清并降低继续深挖概率。
- 输入“这么多追问吗”不会在报告中只被当作普通技术回答，也不会继续无上下文深挖。

### P1-2：调整 guaranteed follow-up 策略

改动位置：

- `../my-first-agent-langgraph/src/app/domain/interview_state_machine.py`

方案：

1. 保留专业技能轮追问能力，但不要无条件保证 2 个追问。
2. 建议改为：
   - 第 1 个追问可保证，用于自然深挖。
   - 第 2 个追问必须满足至少一个条件：
     - 当前回答分数低于阈值。
     - 有 missing/incorrect points。
     - 真实回答中出现可深挖的具体概念。
     - 候选人没有明确表示没经验/不是自己的回答/不想继续追问。
3. 项目轮同理使用更强的 evidence gate。

验收标准：

- 对低信息量或否认类回答，系统能进入下一主问题，而不是固定追问到上限。
- 对高质量回答，仍能自然深挖 1 到 2 轮。

### P1-3：OpenTelemetry 本地开发配置收敛

改动位置：

- `../my-first-agent-langgraph/README.md`
- host repo local start script / env example，如涉及本地 stack 编排再同步检查 host 配置。

方案：

1. 本地未启动 collector 时，在 `.env` 设置：
   - `OTEL_SDK_DISABLED=true`
2. 如果需要 Tempo/Grafana，则确保 `npm run start:local` 或 docker compose 会启动 OTLP collector/Tempo，并暴露 `4318`。
3. 在 README 增加故障说明：
   - `WinError 10061 localhost:4318` 表示 collector 没启动。
   - 关闭 tracing 或启动 collector 二选一。

验收标准：

- 默认本地测试日志不再刷屏 `trace_exporter` 连接失败。
- 启动观测栈时 tracing 正常导出。

## 测试计划

### 单元测试

1. `follow_up_generation` prompt 测试：
   - prompt 必须包含 `Current candidate answer`。
   - prompt 必须包含当前节点对话。
   - 简历内容不能被描述成候选人当前回答。
2. `build_follow_up_question` 兜底模板测试：
   - generated question 为空时，中文和英文兜底文案都不包含“你提到/you mentioned”。
3. `classify_by_rules` 测试：
   - `没有用过虚拟线程` 不应是普通 `direct-answer` 深挖路径。
   - `这不是我的回答` 应触发澄清/纠正路径。
   - `这么多追问吗` 应触发 meta-question 路径。
4. structured output 策略测试：
   - DeepSeek 配置下直接 raw JSON 调用。
   - OpenAI native 配置下仍使用 structured output。
   - native structured output 返回 DeepSeek 不支持错误后，fallback 成功且后续不重复 native 尝试。

### 集成/合同测试

1. 从 BFF stream contract 角度验证 SSE 形状不变：
   - `text-delta`
   - `tool-result` with `interviewStateManagerTool`
   - `[DONE]`
2. 端到端跑一轮包含以下回答的面试：
   - 有实践的回答。
   - `没有用过...`
   - `我没有提到...`
   - `这么多追问吗`
3. 验证报告生成仍可完成，且 markdown/status/read API 不变。

### 建议命令

在 `../my-first-agent-langgraph` 执行：

```bash
.venv\Scripts\python -m pytest tests
.venv\Scripts\ruff check .
```

若只改 domain 逻辑，可先跑更小范围：

```bash
.venv\Scripts\python -m pytest tests\unit
.venv\Scripts\ruff check src\app\domain src\app\integrations
```

## 风险与注意事项

1. 不要把修复做回 host repo 的 `src/mastra/**`，该目录已归档。
2. 修改 Python runtime 前必须先读取 host repo 的 `.github/instructions/langgraph-architecture.instructions.md`。
3. 修改 LangGraph runtime 后必须运行 `project-architecture-sync` skill，并执行：

```bash
node .github/hooks/scripts/project-architecture-sync-guard.mjs record
```

4. 追问 prompt 加入候选人回答会增加日志敏感性。当前 `app.llm` 已记录完整 prompt，后续如果要保留生产可观测性，需要考虑按环境关闭正文日志或做脱敏。
5. 如果将实时规则评估替换成 LLM 评估，要注意延迟和成本；建议先增强规则 gate，再评估是否需要异步/轻量 LLM evaluator。

## 推荐优先级

1. P0：关闭 DeepSeek native structured output，减少错误和延迟。
2. P0：追问 prompt 加入真实候选人回答，并禁止把简历/JD/RAG 当成“你提到”。
3. P0：兜底追问模板去掉“你提到”。
4. P1：增强否定/纠正/meta 回答识别，调整 guaranteed follow-up。
5. P1：收敛 OpenTelemetry 本地默认配置。

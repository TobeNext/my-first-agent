---
name: project-architecture-sync
description: "Use after any code modification in this repository. Verifies whether the project architecture instruction is still accurate, and updates it when runtime wiring, folder responsibilities, data flow, or coding references changed."
---

# Project Architecture Sync

在这个仓库里，只要发生代码改动，就要在结束前执行本 skill，确保 `.github/instructions/project-architecture.instructions.md` 仍然反映当前实现与关键参考。

### Steps

1. 收集本次代码改动涉及的文件，优先关注 `src/mastra/**`、`package.json`、`README.md` 和 `docs/**` 中与架构相关的内容。
例子：如果改了 `src/mastra/index.ts`，就要检查运行入口和已注册能力是否变化。

2. 对照 `.github/instructions/project-architecture.instructions.md`，检查以下四类信息是否过期：运行入口、目录职责、关键数据流、参考文档。
例子：如果新增了一个 workflow 并在入口注册，就要更新 instruction 里的运行时快照。

3. 仅在有真实变化时更新 instruction；没有变化时，明确记录“已核对，无需更新”。
例子：如果只是修改一个 prompt 文案而未改变结构、接线或参考，则可以保留 instruction 不变，但要说明已经检查过。

4. 更新时必须以代码现状为准，不能把文档中的规划状态误写成“已实现”。
例子：如果某个 doc 写了 Resume Agent 规划，但源码还没有接线，就只能写成未来规划或参考，而不是当前运行能力。

5. 如果本次改动新增了新的核心参考资料，也要把它加入 instruction 的参考列表。
例子：如果新增了一个专门描述向量检索流程的设计文档，并且后续编码会频繁依赖，就把它加到 High-Value References。

6. 完成核对后，必须执行 `node .github/hooks/scripts/project-architecture-sync-guard.mjs record` 记录本次校验已完成，避免 session 结束时被 hook 拦截。
例子：如果你已经确认 instruction 不需要更新，也仍然要执行这条命令，把“已核对、无需更新”的结果记录给 hook。

### Boundary

1. 只维护项目架构 instruction 及其必要参考，不顺手改动无关源码。
例子：发现 `src/mastra/index.ts` 架构描述过期时，可以更新 instruction，但不要顺便重构 agent 代码。

2. 不编造架构，不根据猜测写“已支持”或“已注册”。
例子：如果只看到 `interview-agent.ts` 文件存在，但没看到入口注册，就不能写成当前已对外启用。

3. 不删除已有参考，除非确认它已经失效、被替代或会误导后续编码。
例子：旧文档仍然能提供 Phase 背景时，可以保留并标注为设计参考，而不是直接删掉。

4. 如果本次代码改动没有影响架构，只做核对结论，不制造无意义重写。
例子：修改一个局部工具函数实现且不影响目录职责时，不要为了“看起来更新过”而重写整份 instruction。

### Output

1. 给出已检查的关键文件范围。
例子：`Checked: src/mastra/index.ts, src/mastra/tools/interview-question-tool.ts, docs/INTERVIEW_AGENT_ARCHITECTURE.md`

2. 给出 instruction 是否被更新，以及更新原因。
例子：`Updated instruction because runtime entrypoints changed after interviewAgent was registered in src/mastra/index.ts.`

3. 如果没有更新，也要给出明确结论。
例子：`No instruction update needed. Verified that the code change was local and did not alter architecture, runtime wiring, or references.`

4. 给出 hook 记录已完成的结果。
例子：`Recorded architecture-sync verification with node .github/hooks/scripts/project-architecture-sync-guard.mjs record.`
# Project Architecture Sync Checklist

更新 `.github/instructions/project-architecture.instructions.md` 时，优先核对下面这些来源：

- `src/mastra/index.ts`: 当前 Mastra 运行入口、注册能力、storage/logger/observability 接线
- `src/mastra/agents/*.ts`: Agent 是否存在、是否被接线、是否调整了 memory 或主要职责
- `src/mastra/tools/*.ts`: 工具边界是否变化，是否新增关键工具
- `src/mastra/workflows/*.ts`: 是否新增或替换流程编排
- `src/mastra/lib/*.ts`: 向量存储、RAG、索引初始化等基础设施是否变化
- `src/mastra/scripts/*.ts`: 是否新增了重要的导入、验证或 E2E 脚本
- `package.json`: Node/Mastra 版本、核心依赖、开发命令是否变化
- `README.md`: 是否补充了新的运行方式或开发入口
- `docs/*.md`: 是否新增了后续编码需要频繁参考的架构文档

判断规则：

- 代码现状优先于设计文档
- 只有影响后续编码理解的变化，才需要更新 instruction
- 运行入口、目录职责、关键数据流、参考列表是四个必须检查的维度
- 完成核对后，执行 `node .github/hooks/scripts/project-architecture-sync-guard.mjs record`，让 Stop hook 知道本次改动已经完成架构同步检查

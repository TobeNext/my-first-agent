# TypeScript Development Conventions

> 本文件是 AI 编码助手的通用 TypeScript 开发规范。所有代码编写、审查和重构均应遵循此规范。

---

## 1. 语言与运行时

- **TypeScript 严格模式**: 始终启用 `strict: true`，不使用 `any` 除非有充分理由并加注释说明
- **ES Modules**: 使用 `import/export`，不使用 `require()`
- **目标运行时**: Node.js >= 22，可使用最新 ECMAScript 特性

---

## 2. 命名规范

| 类型 | 风格 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `web-search-tool.ts` |
| 类 / 接口 / 类型 | PascalCase | `InterviewAgent`, `QuestionMetadata` |
| 函数 / 变量 | camelCase | `fetchJobDetails`, `questionList` |
| 常量 | SCREAMING_SNAKE_CASE | `MAX_FOLLOW_UPS`, `DEFAULT_TIMEOUT` |
| 枚举成员 | PascalCase | `QuestionType.SystemDesign` |
| 泛型参数 | 单大写字母或描述性 PascalCase | `T`, `TResult` |

---

## 3. 类型系统

- **优先使用 `interface`** 定义对象形状；用 `type` 定义联合类型、交叉类型、工具类型
- **避免类型断言**（`as`），优先使用类型守卫（type guards）或泛型约束
- **函数返回类型**: 公共函数必须显式标注返回类型；私有/内部函数可依赖推断
- **使用 `readonly`**: 不需要修改的属性和数组用 `readonly` 修饰
- **Zod 优先**: 在系统边界（用户输入、API 响应、环境变量）使用 Zod 做运行时校验，并从 Zod schema 派生 TypeScript 类型

```typescript
// Good — 从 Zod schema 派生类型
const QuestionSchema = z.object({
  questionType: z.enum(['behavioral', 'technical', 'system-design']),
  content: z.string().min(1),
});
type Question = z.infer<typeof QuestionSchema>;

// Avoid — 手动定义类型 + 手动校验
```

---

## 4. 函数设计

- **单一职责**: 每个函数只做一件事，函数体不超过 40 行（不含类型定义）
- **纯函数优先**: 无副作用的逻辑抽为纯函数，便于测试
- **参数设计**: 超过 3 个参数时使用对象参数（options pattern）
- **提前返回**: 使用 guard clause 减少嵌套

```typescript
// Good — guard clause + 对象参数
function searchQuestions(options: {
  jobTitle: string;
  company?: string;
  limit?: number;
}): Promise<Question[]> {
  const { jobTitle, company, limit = 10 } = options;
  if (!jobTitle.trim()) return Promise.resolve([]);
  // ...
}

// Avoid — 深层嵌套
```

---

## 5. 错误处理

- **在系统边界处理错误**: 外部 API 调用、用户输入、文件 I/O
- **使用自定义 Error 类** 区分错误类型:

```typescript
class ToolExecutionError extends Error {
  constructor(
    public readonly toolName: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[${toolName}] ${message}`);
    this.name = 'ToolExecutionError';
  }
}
```

- **不要 swallow 错误**: `catch` 块必须记录日志或重新抛出
- **async 函数**: 始终使用 `try/catch` 或让 Promise rejection 向上传播，不要 `.catch(() => {})` 静默吞错

---

## 6. 异步编程

- **`async/await`** 优先于 `.then()` 链式调用
- **并行操作**: 使用 `Promise.all()` 或 `Promise.allSettled()`（需要部分成功时）
- **避免**:
  - `new Promise()` 构造器（除非封装回调 API）
  - 忘记 `await`（注意 floating promise）
  - 在循环中串行 `await`（应收集后 `Promise.all`）

---

## 7. 模块组织

- **一个文件一个关注点**: 一个 tool、一个 agent、一个 workflow 各占一个文件
- **桶文件（index.ts）**: 仅用于模块入口重新导出，不放业务逻辑
- **循环依赖**: 禁止。如果出现，说明模块边界设计有问题
- **导入顺序**:
  1. Node.js 内置模块
  2. 第三方库（`@mastra/*`, `zod`, 等）
  3. 项目内部模块（相对路径）
  4. 类型导入（`import type`）

---

## 8. Mastra 框架约定

- **Tool 定义**: 使用 `createTool()` 工厂函数，input/output 用 Zod schema 定义
- **Agent 定义**: 每个 Agent 导出为独立变量，在 `index.ts` 中统一注册
- **Workflow 定义**: 使用 `createWorkflow()` + `.step()` 链式定义流程
- **Memory**: 需要多轮对话的 Agent 必须配置 Memory
- **环境变量**: 所有敏感信息（API Key 等）通过 `.env` 注入，代码中通过 `process.env` 读取并用 Zod 校验

---

## 9. 测试规范

- **测试文件命名**: `*.test.ts`，与源文件同目录或在 `__tests__/` 下
- **测试结构**: Arrange → Act → Assert 三段式
- **覆盖优先级**:
  1. Tool 的输入输出转换逻辑
  2. Workflow 的步骤编排逻辑
  3. Agent 的端到端对话测试（通过 Scorer）
- **Mock 策略**: 外部 API 调用必须 mock，内部纯函数直接测试

---

## 10. 代码风格

- **分号**: 必须使用
- **引号**: 单引号 `'`，JSX 属性用双引号
- **缩进**: 2 空格
- **尾逗号**: 多行结构始终添加 (`"trailingComma": "all"`)
- **行宽**: 120 字符上限
- **大括号**: 始终使用，即使单行 `if`

---

## 11. 注释规范

- **不注释显而易见的代码**: 好的命名 > 注释
- **何时写注释**:
  - 业务逻辑的 "为什么"（why），而非 "做什么"（what）
  - 复杂算法或非直觉实现
  - TODO/FIXME 必须标注负责人或 issue 编号
- **JSDoc**: 公共 API / 导出函数编写 JSDoc，包含 `@param` 和 `@returns`

---

## 12. 安全规范

- **不硬编码密钥**: 所有 secret 通过环境变量注入
- **输入校验**: 所有外部输入（用户输入、API 响应）用 Zod 校验后再使用
- **不执行动态代码**: 禁止 `eval()`、`new Function()`
- **依赖安全**: 定期检查依赖漏洞（`npm audit`）
- **日志脱敏**: 日志中不输出 API Key、用户隐私数据

---

## 13. Git 提交规范

- **Conventional Commits** 格式: `type(scope): description`
  - `feat`: 新功能
  - `fix`: Bug 修复
  - `refactor`: 重构（不改变行为）
  - `docs`: 文档
  - `test`: 测试
  - `chore`: 构建/工具链
- **每个 commit 只做一件事**: 不要混合功能和重构
- **示例**: `feat(research-agent): implement web search tool with Tavily API`

---

## 14. 项目架构同步要求

- **代码改动后强制执行**: 只要本仓库发生代码改动，结束前必须运行 `project-architecture-sync` skill
- **同步目标**: 检查并按需更新 `.github/instructions/project-architecture.instructions.md`
- **核对标准**: 至少检查运行入口、目录职责、关键数据流、参考文档是否因本次改动而过期
- **禁止跳过**: 即使最终无需更新 instruction，也必须先完成一次核对，再结束任务
- **Hook 强校验**: 工作区 hooks 会在 session 结束时阻止未完成架构同步记录的代码改动收尾；完成核对后执行 `node .github/hooks/scripts/project-architecture-sync-guard.mjs record`

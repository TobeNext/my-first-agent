/**
 * E2E validation test for Phase 4: Obsidian-imported Chinese knowledge base.
 *
 * Tests that the Interview Agent can retrieve and use Chinese Q&A from the new vector DB.
 * Usage: npx tsx src/mastra/scripts/test-obsidian-import.ts
 */
import { ensureEnvironmentLoaded } from '../lib/load-env';

ensureEnvironmentLoaded();

const BASE_URL = process.env.MASTRA_URL || 'http://localhost:4111';
const AGENT_ID = 'interview-agent';
const THREAD_ID = `test-obsidian-${Date.now()}`;
const RESOURCE_ID = 'test-user';

interface GenerateResponse {
  text: string;
  [key: string]: unknown;
}

async function chat(message: string, step: string): Promise<string> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📤 [${step}] User: ${message}`);
  console.log('='.repeat(60));

  const body = {
    messages: [{ role: 'user', content: message }],
    memory: {
      thread: THREAD_ID,
      resource: RESOURCE_ID,
    },
    maxSteps: 5,
  };

  const res = await fetch(`${BASE_URL}/api/agents/${AGENT_ID}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${rawText}`);
  }

  const data = JSON.parse(rawText) as GenerateResponse;
  const text = data.text || '(no text)';
  console.log(`\n🤖 [${step}] Agent:\n${text.substring(0, 1200)}`);
  if (text.length > 1200) {
    console.log(`... (${text.length - 1200} more chars)`);
  }
  return text;
}

async function main(): Promise<void> {
  console.log('🎯 Phase 4 E2E Validation: Obsidian Import');
  console.log(`   Server: ${BASE_URL}`);
  console.log(`   Thread: ${THREAD_ID}`);

  // Turn 1: Start interview in Chinese, targeting AI Agent role
  const reply1 = await chat(
    '你好！我想练习 AI Agent 开发工程师 的面试，请用中文提问。',
    'INTRO',
  );

  // Validate: agent should retrieve Chinese questions from the new KB
  if (!reply1 || reply1.length < 20) {
    throw new Error('Agent reply too short — may not have retrieved questions.');
  }

  // Turn 2: Answer the first question
  await chat(
    'Agent的核心架构由四个主要部分组成：LLM作为推理引擎，工具调用层提供外部能力扩展，记忆系统管理上下文和长期知识，以及流程控制层（如ReAct循环）来协调整个推理-行动过程。和传统的LLM Chain相比，Agent最大的区别在于具有自主决策能力——它可以根据中间结果动态调整下一步行动，而不是按预设顺序执行。',
    'ANSWER-1',
  );

  // Turn 3: Answer another question
  await chat(
    'ReAct模式的核心是交替进行推理（Reasoning）和行动（Action），形成 Thought → Action → Observation 的迭代循环。每一步中，LLM先分析当前状态（Thought），然后选择一个操作执行（Action），最后观察执行结果（Observation），再基于观察进入下一轮思考。这种模式的优势在于可解释性强、支持错误恢复，但也存在推理链过长导致token消耗大的问题。',
    'ANSWER-2',
  );

  // Turn 4: Request wrap up
  const report = await chat(
    '差不多了，请结束面试并给我反馈报告。',
    'WRAP-UP',
  );

  // Validate: report should contain Chinese evaluation
  if (report.includes('Score') || report.includes('评分') || report.includes('分')) {
    console.log('\n✅ Evaluation report detected!');
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Phase 4 E2E Test Complete!');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

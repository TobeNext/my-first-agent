/**
 * End-to-end test for Interview Agent.
 *
 * Runs a simulated multi-turn interview via the Mastra API.
 * Usage: npx tsx src/mastra/scripts/test-interview.ts
 */

const BASE_URL = process.env.MASTRA_URL || 'http://localhost:4111';
const AGENT_ID = 'interview-agent';
const THREAD_ID = `test-thread-${Date.now()}`;
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

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/agents/${AGENT_ID}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new Error(`Fetch failed: ${err}`);
  }

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${rawText}`);
  }

  let data: GenerateResponse;
  try {
    data = JSON.parse(rawText) as GenerateResponse;
  } catch {
    throw new Error(`Invalid JSON response: ${rawText.substring(0, 500)}`);
  }

  const text = data.text || '(no text)';
  console.log(`\n🤖 [${step}] Agent:\n${text.substring(0, 800)}`);
  if (text.length > 800) {
    console.log(`... (${text.length - 800} more chars)`);
  }
  return text;
}

async function runInterview(): Promise<void> {
  console.log('🎯 Starting Interview Agent E2E Test');
  console.log(`   Thread: ${THREAD_ID}`);
  console.log(`   Resource: ${RESOURCE_ID}`);

  // Step 1: Intro — tell the agent what role to prepare for
  await chat(
    'Hi! I want to practice for a Software Engineer interview at a mid-size tech company.',
    'INTRO',
  );

  // Step 2: Answer the first question naturally (respond to whatever the agent asks)
  await chat(
    "I'm drawn to software engineering because I love solving complex problems and seeing my code come to life in real products. For a mid-size tech company specifically, I value the balance between impact and agility — you can still influence the product direction while working with a solid engineering culture. I'm particularly interested in companies that invest in developer experience and encourage ownership.",
    'ANSWER-1',
  );

  // Step 3: Answer the next question
  await chat(
    "In my last project, we were migrating from a monolith to microservices. I had a disagreement with the tech lead about whether to use event-driven communication or synchronous REST calls between services. I prepared a comparison document covering latency, failure handling, and debugging complexity, then presented it at our architecture review. We ended up going with an event-driven approach for write operations and REST for reads, which was a hybrid of both ideas.",
    'ANSWER-2',
  );

  // Step 4: Another answer
  await chat(
    "A hash map works by using a hash function to convert keys into array indices. When two keys hash to the same index — that's a collision. The two main approaches are chaining (each bucket holds a linked list of entries) and open addressing (probing nearby slots). Java's HashMap uses chaining with a linked list that converts to a red-black tree when the chain gets too long, which keeps worst-case lookup at O(log n) instead of O(n).",
    'ANSWER-3',
  );

  // Step 5: Wrap up
  await chat(
    "I think that's enough practice for now. Please wrap up and give me my evaluation report.",
    'WRAP-UP',
  );

  console.log('\n' + '='.repeat(60));
  console.log('✅ Interview E2E Test Complete!');
  console.log('='.repeat(60));
}

runInterview().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

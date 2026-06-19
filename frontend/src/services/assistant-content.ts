const HIDDEN_ASSISTANT_TEXT =
  "I'll parse your resume first to understand your professional skills and project experience before starting the interview.";

const LEGACY_ASYNC_REPORT_WAIT_PATTERNS = [
  /面试题目已经完成，我正在等待异步评分完成后生成最终报告。当前进度：\d+\/\d+。请稍后再发送一条消息获取报告。/g,
  /The interview questions are complete\. I am waiting for async evaluations before generating the final report\. Current progress: \d+\/\d+\. Please send another message shortly to fetch the report\./g,
];

export function sanitizeAssistantContent(content: string): string {
  return LEGACY_ASYNC_REPORT_WAIT_PATTERNS.reduce(
    (nextContent, pattern) => nextContent.replace(pattern, ''),
    content.replaceAll(HIDDEN_ASSISTANT_TEXT, ''),
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

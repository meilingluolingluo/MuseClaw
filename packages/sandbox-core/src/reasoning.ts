/**
 * 解析并分离文本中的模型思考推理过程与正式答复正文
 */
export function splitReasoningAndContent(
  rawContent?: string,
  rawReasoning?: string
): { content: string; reasoning?: string } {
  let content = rawContent || '';
  let reasoning = rawReasoning || '';

  // 1. 提取全闭合的 <think>...</think> 标签内容
  const thinkTagRegex = /<think>([\s\S]*?)<\/think>/gi;
  let thinkMatch: RegExpExecArray | null;
  while ((thinkMatch = thinkTagRegex.exec(content)) !== null) {
    const th = thinkMatch[1].trim();
    if (th) {
      reasoning = reasoning ? `${reasoning}\n\n${th}` : th;
    }
  }
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. 提取 Markdown 引用块推理「> 💭 **思考推理**：...」或「> 💭 思考推理：...」
  const quoteReasoningRegex = /(?:^|\n)(?:>\s*💭\s*(?:\*\*)?思考推理(?:\*\*)?[：:]?\s*\n(?:>[^\n]*\n?)*)+/g;
  const quoteMatches = content.match(quoteReasoningRegex);
  if (quoteMatches) {
    for (const match of quoteMatches) {
      const extractedLines = match
        .split('\n')
        .map((line) => line.replace(/^>\s*/, ''))
        .filter((line) => !line.includes('💭') && !line.includes('思考推理'))
        .join('\n')
        .trim();
      if (extractedLines) {
        reasoning = reasoning ? `${reasoning}\n\n${extractedLines}` : extractedLines;
      }
    }
    content = content.replace(quoteReasoningRegex, '').trim();
  }

  // 3. 提取非引用块的「💭 **思考推理**：...」或「💭 思考推理：...」开头
  const unquotedReasoningRegex = /(?:^|\n)💭\s*(?:\*\*)?思考推理(?:\*\*)?[：:]?\s*\n([\s\S]*?)(?=(?:\n\n[^\n]+|$))/g;
  let unquotedMatch: RegExpExecArray | null;
  while ((unquotedMatch = unquotedReasoningRegex.exec(content)) !== null) {
    const th = unquotedMatch[1].trim();
    if (th) {
      reasoning = reasoning ? `${reasoning}\n\n${th}` : th;
    }
  }
  content = content.replace(unquotedReasoningRegex, '').trim();

  // 4. 处理尚未闭合的 <think>... 尾部
  const unclosedThinkMatch = content.match(/<think>([\s\S]*)$/i);
  if (unclosedThinkMatch) {
    const th = unclosedThinkMatch[1].trim();
    if (th) {
      reasoning = reasoning ? `${reasoning}\n\n${th}` : th;
    }
    content = content.replace(/<think>[\s\S]*$/i, '').trim();
  }

  return {
    content: content.trim(),
    reasoning: reasoning.trim() || undefined
  };
}

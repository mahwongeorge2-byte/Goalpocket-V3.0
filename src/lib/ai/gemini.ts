import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';

type CreateParams = Parameters<Anthropic['beta']['messages']['create']>[0];
type Msg = { role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> };
type ToolDef = { name: string; description?: string; input_schema: unknown };
type OpenAITool = { type: 'function'; function: { name: string; description?: string; parameters: unknown; strict: true } };

/** Adapt Goalpocket's existing Anthropic-shaped tool loop to Gemini's OpenAI-compatible API. */
export async function geminiCreate(params: CreateParams): Promise<BetaMessage> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const p = params as unknown as {
    model: string;
    max_tokens?: number;
    system?: string | Array<{ text?: string }>;
    messages: Msg[];
    tools?: ToolDef[];
  };

  const messages: Record<string, unknown>[] = [];
  const systemText = typeof p.system === 'string'
    ? p.system
    : (p.system ?? []).map((part) => part.text ?? '').filter(Boolean).join('\n');

  if (systemText) messages.push({ role: 'system', content: systemText });

  for (const message of p.messages) {
    if (typeof message.content === 'string') {
      messages.push({ role: message.role, content: message.content });
      continue;
    }

    if (message.role === 'assistant') {
      const text = message.content
        .filter((b) => b.type === 'text')
        .map((b) => String(b.text ?? ''))
        .join('\n');
      const toolCalls = message.content
        .filter((b) => b.type === 'tool_use')
        .map((b, index) => ({
          id: String(b.id ?? `goalpocket_call_${index}`),
          type: 'function',
          function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) },
        }));
      messages.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    // Anthropic tool results become OpenAI-compatible tool messages.
    for (const block of message.content.filter((b) => b.type === 'tool_result')) {
      const content = typeof block.content === 'string'
        ? block.content
        : JSON.stringify(block.content ?? {});
      messages.push({
        role: 'tool',
        tool_call_id: String(block.tool_use_id ?? ''),
        content,
      });
    }
  }

  const tools: OpenAITool[] = (p.tools ?? []).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
      strict: true,
    },
  }));

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: p.model,
      messages,
      ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
      max_tokens: p.max_tokens ?? 2000,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(50_000),
  });

  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string };
    choices?: Array<{
      finish_reason?: string | null;
      message?: {
        content?: string | null;
        refusal?: string | null;
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Gemini API request failed (${response.status})`);
  }

  const choice = payload.choices?.[0];
  const answer = choice?.message;
  if (!answer) throw new Error('Gemini returned an empty response');

  const content: BetaMessage['content'] = [];
  if (answer.content) {
    content.push({ type: 'text', text: answer.content, citations: null } as BetaMessage['content'][number]);
  }
  for (const [index, call] of (answer.tool_calls ?? []).entries()) {
    let input: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(call.function?.arguments ?? '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
    } catch {
      throw new Error('Gemini returned invalid tool arguments');
    }
    content.push({
      type: 'tool_use',
      id: call.id ?? `gemini_call_${index}`,
      name: call.function?.name ?? '',
      input,
    } as BetaMessage['content'][number]);
  }

  const finish = choice?.finish_reason;
  const stopReason = answer.refusal ? 'refusal' : (answer.tool_calls?.length ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn');

  return {
    id: `gemini_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: p.model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: payload.usage?.prompt_tokens ?? 0,
      output_tokens: payload.usage?.completion_tokens ?? 0,
    },
  } as BetaMessage;
}

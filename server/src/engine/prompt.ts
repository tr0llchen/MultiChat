import type { ChatMessage } from '../providers/types.ts';
import type { Message, Participant } from '../repo.ts';

export const PASS_TOKEN = '[PASS]';

/** True while a partial reply could still turn out to be a pass. */
export function couldBePass(partial: string): boolean {
  return PASS_TOKEN.startsWith(partial.trim().toUpperCase());
}

export function isPass(content: string): boolean {
  return /^\[?PASS\]?[.!]?$/i.test(content.trim());
}

export function buildSystemPrompt(self: Participant, all: Participant[], userName: string, topic: string): string {
  const others = all.filter((p) => p.id !== self.id);
  const lines = [
    `You are "${self.name}", one participant in a round-table discussion between a human (${userName}) and several AI models.`,
    others.length > 0
      ? `The other AI participants are: ${others.map((p) => `"${p.name}"`).join(', ')}.`
      : 'You are currently the only AI participant.',
    `The topic of the discussion: ${topic}`,
    '',
    'The goal is to reach the best possible answer together. To get there:',
    '- Engage with what the others actually said. Point out mistakes, gaps and weak reasoning, and say what you would do instead.',
    '- Do not agree just to be polite, and do not repeat points that were already made. If someone corrected you and they are right, say so.',
    `- Messages from others are prefixed with their name in square brackets. Do not prefix your own replies with your name.`,
    `- ${userName} leads the discussion. Follow their requests.`,
    `- If you have nothing substantial to add, reply with exactly ${PASS_TOKEN} and nothing else.`,
    '- Be concise.',
  ];
  if (self.rolePrompt.trim()) {
    lines.push('', `Your role in this discussion: ${self.rolePrompt.trim()}`);
  }
  return lines.join('\n');
}

/**
 * Converts the shared transcript into the alternating user/assistant format
 * chat APIs expect, from one participant's point of view: its own replies are
 * "assistant" turns and everything else is merged into "user" turns.
 */
export function buildMessages(
  self: Participant,
  all: Participant[],
  transcript: Message[],
  userName: string,
): ChatMessage[] {
  const names = new Map(all.map((p) => [p.id, p.name]));
  const out: ChatMessage[] = [];

  for (const msg of transcript) {
    if (!msg.content.trim() || msg.status === 'passed' || msg.status === 'error' || msg.status === 'streaming') continue;
    const own = msg.participantId === self.id;
    const role = own ? 'assistant' : 'user';
    const speaker = msg.participantId === null ? userName : (names.get(msg.participantId) ?? 'Unknown');
    const text = own ? msg.content : `[${speaker}]: ${msg.content}`;
    const last = out.at(-1);
    if (last && last.role === role) last.content += `\n\n${text}`;
    else out.push({ role, content: text });
  }

  // Chat APIs need the conversation to start and end with a user turn.
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: '(The discussion begins.)' });
  if (out.at(-1)?.role !== 'user') {
    out.push({ role: 'user', content: `(It is your turn again. Continue the discussion, or reply ${PASS_TOKEN}.)` });
  }
  return out;
}

/** Finds participants addressed with @Name. Longer names win, so "@GPT-4o" does not also match "GPT-4". */
export function findMentions(content: string, participants: Participant[]): number[] {
  let haystack = content.toLowerCase();
  const found = new Set<number>();
  for (const p of [...participants].sort((a, b) => b.name.length - a.name.length)) {
    const needle = `@${p.name.toLowerCase()}`;
    let at = haystack.indexOf(needle);
    while (at !== -1) {
      found.add(p.id);
      haystack = haystack.slice(0, at) + ' '.repeat(needle.length) + haystack.slice(at + needle.length);
      at = haystack.indexOf(needle);
    }
  }
  return participants.filter((p) => found.has(p.id)).map((p) => p.id);
}

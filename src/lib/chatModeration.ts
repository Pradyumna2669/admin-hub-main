const BLOCKED_CHAT_TERMS = [
  'fuck',
  'fucking',
  'motherfucker',
  'bitch',
  'slut',
  'whore',
  'pussy',
  'dick',
  'cock',
  'penis',
  'vagina',
  'boobs',
  'tits',
  'blowjob',
  'handjob',
  'porn',
  'xxx',
  'nude',
  'nudes',
  'masturbat',
  'horny',
  'anal',
  'cum',
  'cumming',
  'nsfw',
];

export const findBlockedChatTerm = (content: string) => {
  const normalized = content.trim().toLowerCase();
  if (!normalized) return null;

  return BLOCKED_CHAT_TERMS.find((term) => normalized.includes(term)) || null;
};

export const getDeletedMessageLabel = (reason?: string | null) =>
  reason?.trim()
    ? `Message removed by moderation. Reason: ${reason.trim()}`
    : 'Message removed by moderation.';

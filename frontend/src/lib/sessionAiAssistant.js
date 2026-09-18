const TYPE_KEYWORD_RULES = [
  { id: "risk", keywords: ["ризик", "загроз", "небезпек", "risk", "danger", "concern", "запуск", "launch"] },
  { id: "retro", keywords: ["ретро", "спринт", "ітерац", "retro", "sprint", "iteration"] },
  { id: "delphi", keywords: ["delphi", "дельфі", "експерт", "консенсус", "expert", "consensus", "раунд", "round"] },
  { id: "feedback", keywords: ["фідбек", "feedback", "відгук", "review", "чесн", "honest", "реліз", "release"] },
  { id: "brainstorm", keywords: ["ідеї", "ideas", "брейншторм", "brainstorm", "мозков", "generate"] },
];

// Index into t.createVotingModes: 0 none, 1 upvote, 2 dot voting, 3 rating, 4 ranking, 5 repeat.
const VOTING_KEYWORD_RULES = [
  { index: 4, keywords: ["ранжу", "rank"] },
  { index: 3, keywords: ["оцін", "rating", "score", "бал"] },
  { index: 2, keywords: ["голосу", "voting", "dot", "пріоритиз", "prioriti"] },
  { index: 1, keywords: ["підтрим", "upvote", "лайк", "like"] },
];

const DEFAULT_VOTING_BY_TYPE = {
  feedback: 0,
  brainstorm: 2,
  retro: 2,
  risk: 2,
  delphi: 5,
  custom: 2,
};

const ANONYMITY_KEYWORDS = ["анонім", "anonym", "конфіденц", "confidential", "приватн", "private"];

function scoreType(normalized) {
  let best = { id: null, score: 0 };
  for (const rule of TYPE_KEYWORD_RULES) {
    const score = rule.keywords.reduce((acc, kw) => acc + (normalized.includes(kw) ? 1 : 0), 0);
    if (score > best.score) best = { id: rule.id, score };
  }
  return best.id || "custom";
}

export function analyzeSessionDescription(text) {
  const normalized = (text || "").toLowerCase();
  const sessionTypeId = scoreType(normalized);

  let votingModeIndex = DEFAULT_VOTING_BY_TYPE[sessionTypeId] ?? 2;
  for (const rule of VOTING_KEYWORD_RULES) {
    if (rule.keywords.some((kw) => normalized.includes(kw))) {
      votingModeIndex = rule.index;
      break;
    }
  }

  const anonymityExplicit = ANONYMITY_KEYWORDS.some((kw) => normalized.includes(kw));

  return { sessionTypeId, votingModeIndex, anonymityExplicit };
}

import { SessionData, SessionSummary } from "../types/session";

export const sidebarMethodologies = [
  "Шість капелюхів",
  "Brainwriting",
  "Delphi method",
  "Start / Stop / Continue",
  "SWOT Analysis",
  "Q&A + Голосування",
];

export const dashboardSessions: SessionSummary[] = [
  {
    title: "Ретроспектива продуктового спринту",
    method: "Start / Stop / Continue",
    participants: 12,
    status: "active",
    updatedAt: "Оновлено 12 хв тому",
  },
  {
    title: "Генерація ідей для Q4 roadmap",
    method: "Brainwriting",
    participants: 18,
    status: "draft",
    updatedAt: "Оновлено вчора",
  },
  {
    title: "Оцінка запуску партнерської програми",
    method: "SWOT Analysis",
    participants: 9,
    status: "completed",
    updatedAt: "Завершено 24 травня",
  },
];

export const quickTemplates = [
  "Швидкий брейнрайтинг на 30 хв",
  "SWOT для продуктового рішення",
  "Delphi для стратегічних питань",
  "Q&A + голосування для all-hands",
];

export const sessionMock: SessionData = {
  title: "Ідеї для розвитку GhostTalk у B2B сегменті",
  methodName: "Brainwriting",
  participantsCount: 24,
  isAnonymous: true,
  currentStage: "Збір ідей",
  stageIndex: 1,
  stageProgress: 64,
  sessionCode: "X7K9P2",
  facilitatorName: "Олена К.",
  timer: "14:32",
  participantInitials: ["AK", "IM", "NP", "TS", "YD", "VK", "OL", "RM", "EP", "DN"],
  columns: [
    {
      id: "product",
      title: "Продуктові ідеї",
      ideas: [
        {
          id: "1",
          text: "Додати AI-помічника для підсумку сесії",
          votes: 18,
          comments: 5,
        },
        {
          id: "2",
          text: "Автоматичне групування схожих думок",
          votes: 14,
          comments: 4,
        },
        {
          id: "3",
          text: "Бібліотека успішних кейсів",
          votes: 9,
          comments: 2,
        },
      ],
    },
    {
      id: "delivery",
      title: "Доставка цінності",
      ideas: [
        {
          id: "4",
          text: "Експорт підсумків у PDF та Google Docs",
          votes: 13,
          comments: 3,
        },
        {
          id: "5",
          text: "Ролі та права для фасилітаторів",
          votes: 11,
          comments: 6,
        },
      ],
    },
    {
      id: "integrations",
      title: "Інтеграції та аналітика",
      ideas: [
        {
          id: "6",
          text: "Інтеграція з Slack та Microsoft Teams",
          votes: 16,
          comments: 7,
        },
        {
          id: "7",
          text: "Аналітика залученості учасників",
          votes: 12,
          comments: 4,
        },
      ],
    },
  ],
};

import React, { createContext, useContext, useMemo, useState } from "react";

const STORAGE_KEY = "ghosttalk_lang";

const dict = {
  uk: {
    appTagline: "Структуровані анонімні сесії",
    landingTitle: "Анонімна структурована фасилітація",
    landingText: "Створіть сесію, запросіть людей за посиланням або кодом, збирайте анонімні думки, голосуйте в реальному часі та формуйте підсумок.",
    createSession: "Створити сесію",
    joinSession: "Приєднатися",
    joinCode: "Код сесії",
    createTitle: "Створення сесії",
    title: "Назва",
    description: "Опис",
    methodology: "Методологія",
    creating: "Створення...",
    create: "Створити",
    loadingSession: "Завантаження сесії...",
    loadingFacilitator: "Завантаження панелі фасилітатора...",
    addThought: "Додати анонімну думку",
    voiceMock: "Голосовий ввід (мок)",
    submit: "Надіслати",
    upvote: "Підтримати",
    votes: "голосів",
    noCards: "Поки немає карток",
    facilitator: "Фасилітатор",
    joinCodeLabel: "Код приєднання",
    stopVoting: "Зупинити голосування",
    startVoting: "Запустити голосування",
    endSession: "Завершити сесію",
    openSummary: "Відкрити підсумок",
    summaryEditor: "Редактор підсумку",
    topIdeasNotes: "Топ ідей / нотатки (Markdown)",
    groupedThoughts: "Згруповані думки",
    risksQuestions: "Ризики / Питання",
    actionItems: "Пункти дій",
    saveSummary: "Зберегти підсумок",
    summaryTitle: "Підсумок сесії",
    exportMd: "Експортувати Markdown",
    loadingSummary: "Завантаження підсумку...",
    hide: "Сховати",
    unhide: "Показати",
    move: "Перемістити",
    missingFacilitatorToken: "Відсутній токен фасилітатора.",
    facilitatorTokenRequired: "Потрібен токен фасилітатора",
    mockVoicePrompt: "Мок голосового вводу: введіть розпізнаний текст",
    methodLabel: "Метод",
  },
  en: {
    appTagline: "Structured anonymous sessions",
    landingTitle: "Anonymous structured facilitation",
    landingText: "Create a session, invite people by link or code, collect anonymous thoughts, vote in realtime, and publish a summary.",
    createSession: "Create Session",
    joinSession: "Join Session",
    joinCode: "Join code",
    createTitle: "Create session",
    title: "Title",
    description: "Description",
    methodology: "Methodology",
    creating: "Creating...",
    create: "Create",
    loadingSession: "Loading session...",
    loadingFacilitator: "Loading facilitator dashboard...",
    addThought: "Add anonymous thought",
    voiceMock: "Voice Input (Mock)",
    submit: "Submit",
    upvote: "Upvote",
    votes: "votes",
    noCards: "No cards yet",
    facilitator: "Facilitator",
    joinCodeLabel: "Join code",
    stopVoting: "Stop Voting",
    startVoting: "Start Voting",
    endSession: "End Session",
    openSummary: "Open Summary",
    summaryEditor: "Final summary editor",
    topIdeasNotes: "Top ideas / notes (Markdown)",
    groupedThoughts: "Grouped thoughts",
    risksQuestions: "Risks / Questions",
    actionItems: "Action items",
    saveSummary: "Save Summary",
    summaryTitle: "Session summary",
    exportMd: "Export Markdown",
    loadingSummary: "Loading summary...",
    hide: "Hide",
    unhide: "Unhide",
    move: "Move",
    missingFacilitatorToken: "Missing facilitator token.",
    facilitatorTokenRequired: "Facilitator token required",
    mockVoicePrompt: "Mock voice input: type transcribed text",
    methodLabel: "Method",
  },
};

const methodLabels = {
  brainwriting: { uk: "Брейнрайтинг", en: "Brainwriting" },
  swot: { uk: "SWOT", en: "SWOT" },
  start_stop_continue: { uk: "Почати / Зупинити / Продовжити", en: "Start / Stop / Continue" },
  anonymous_qa: { uk: "Анонімні Q&A", en: "Anonymous Q&A" },
  ideas: { uk: "Ідеї", en: "Ideas" },
  strengths: { uk: "Сильні сторони", en: "Strengths" },
  weaknesses: { uk: "Слабкі сторони", en: "Weaknesses" },
  opportunities: { uk: "Можливості", en: "Opportunities" },
  threats: { uk: "Загрози", en: "Threats" },
  start: { uk: "Почати", en: "Start" },
  stop: { uk: "Зупинити", en: "Stop" },
  continue: { uk: "Продовжити", en: "Continue" },
  questions: { uk: "Питання", en: "Questions" },
  answers: { uk: "Відповіді", en: "Answers" },
};

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem(STORAGE_KEY) || "uk");

  const value = useMemo(() => ({
    lang,
    setLang: (next) => {
      localStorage.setItem(STORAGE_KEY, next);
      setLang(next);
    },
    t: dict[lang],
    methodLabel: (key) => methodLabels[key]?.[lang] || key,
  }), [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

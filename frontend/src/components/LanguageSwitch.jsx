import { useI18n } from "../i18n.jsx";

const languages = [
  { code: "uk", label: "UA" },
  { code: "en", label: "EN" },
];

export default function LanguageSwitch() {
  const { lang, setLang } = useI18n();

  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-border bg-slate-50 p-0.5 text-sm font-medium"
      role="group"
      aria-label="Language switch"
    >
      {languages.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={`rounded-full px-2.5 py-1 transition-colors ${
            lang === code ? "bg-primary text-white" : "text-text-secondary hover:bg-slate-100"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

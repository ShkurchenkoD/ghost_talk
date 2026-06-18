import { useI18n } from "../i18n.jsx";

export default function LanguageSwitch() {
  const { lang, setLang } = useI18n();

  return (
    <div className="lang-switch" role="group" aria-label="Language switch">
      <button className={lang === "uk" ? "active" : ""} onClick={() => setLang("uk")}>UA</button>
      <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
    </div>
  );
}

import { useState } from "react";
import { useI18n } from "../i18n.jsx";

export default function CardItem({ card, onVote, canVote, facilitator, onPatch, categories }) {
  const [nextCategory, setNextCategory] = useState(card.category);
  const { t, methodLabel } = useI18n();

  return (
    <article className={`idea-card ${card.hidden ? "is-hidden" : ""}`}>
      <p>{card.text}</p>
      <footer className="card-footer">
        <small>#{card.id} · {new Date(card.created_at).toLocaleTimeString()}</small>
        <strong>{card.vote_count} {t.votes}</strong>
      </footer>
      <div className="card-actions">
        {onVote && (
          <button disabled={!canVote || card.hidden} onClick={() => onVote(card.id)}>
            {t.upvote}
          </button>
        )}
        {facilitator && (
          <>
            <button onClick={() => onPatch(card.id, { hidden: !card.hidden })}>{card.hidden ? t.unhide : t.hide}</button>
            <select value={nextCategory} onChange={(e) => setNextCategory(e.target.value)}>
              {categories.map((category) => (
                <option key={category} value={category}>{methodLabel(category)}</option>
              ))}
            </select>
            <button disabled={nextCategory === card.category} onClick={() => onPatch(card.id, { category: nextCategory })}>
              {t.move}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

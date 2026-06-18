import CardItem from "./CardItem";
import { useI18n } from "../i18n.jsx";

export default function CardBoard({ categories = [], cards = [], onVote, canVote, onPatch, facilitator }) {
  const { t, methodLabel } = useI18n();

  return (
    <div className="board-grid">
      {categories.map((category) => {
        const items = cards.filter((c) => c.category.toLowerCase() === category.toLowerCase());
        return (
          <section className="board-column" key={category}>
            <h3>{methodLabel(category)}</h3>
            <div className="cards-stack">
              {items.map((card) => (
                <CardItem
                  key={card.id}
                  card={card}
                  onVote={onVote}
                  canVote={canVote}
                  facilitator={facilitator}
                  onPatch={onPatch}
                  categories={categories}
                />
              ))}
              {items.length === 0 && <div className="empty-card">{t.noCards}</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

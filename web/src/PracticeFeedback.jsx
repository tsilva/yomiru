import { useCallback, useEffect, useState } from "react";
import { PracticeComboFox } from "./PracticeComboFox.jsx";
import { masteryAt } from "./vocabulary-practice.mjs";

export function usePracticeFeedback() {
  const [combo, setCombo] = useState({ count: 0, outcome: null, eventId: 0 });
  const [credits, setCredits] = useState([]);
  const dismissCredit = useCallback(id => setCredits(previous => previous.filter(credit => credit.id !== id)), []);

  function recordComboOutcome(outcome) {
    setCombo(previous => ({
      count: outcome === "correct" ? previous.count + 1 : 0,
      outcome,
      eventId: previous.eventId + 1,
    }));
  }

  function recordMasteryCredit(id, card, before, word, at, correct) {
    const from = masteryAt(before, at);
    const to = masteryAt(word, at);
    if (correct || to !== from) {
      setCredits(previous => [...previous.filter(credit => credit.card.id !== card.id).slice(-2),
        { id, card, from, to }]);
    }
  }

  return { combo, recordComboOutcome, masteryCredits: { credits, dismissCredit }, recordMasteryCredit };
}

export function PracticeCombo({ combo: { count, outcome, eventId }, chat, hideCount = false }) {
  const milestone = count > 0 && count % 5 === 0;
  const fox = <PracticeComboFox key={eventId} combo={count} milestone={milestone} outcome={outcome} />;
  return <span className="practice__combo">
    {!hideCount && <span className="practice__combo-count">Combo{" "}
      <strong key={count} data-combo-hit={count > 0 || undefined} data-combo-milestone={milestone || undefined}>
        ×{count}
        {milestone && <span className="practice__combo-sparks" aria-hidden="true"><span /><span /><span /></span>}
      </strong>
    </span>}
    {chat ? <button type="button" className="practice-chat__toggle" ref={chat.button} disabled={chat.disabled}
      aria-label={chat.open ? "Close chat with Yomiru" : "Ask Yomiru"} aria-expanded={chat.open}
      aria-controls={chat.open ? chat.id : undefined} onClick={chat.onToggle}>{fox}<span>Ask</span></button> : fox}
  </span>;
}

function MasteryCredit({ credit: { id, card, from, to }, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), 4600);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  const written = card.written ?? card.kana;
  const changed = from !== to;
  const percent = value => value.toLocaleString(undefined, { maximumFractionDigits: 1 }) + "%";
  return <div className="practice__credit">
    <div className="practice__credit-title">
      <span lang="ja"><strong>{written}</strong>{written !== card.kana && <small>{card.kana}</small>}</span>
      <span className="practice__credit-score">{changed && `${percent(from)} → `}{percent(to)}</span>
    </div>
    {card.meaning && <span className="practice__credit-meaning" lang="en">{card.meaning}</span>}
    <div className="practice__credit-track" data-changed={changed || undefined}
      role="progressbar" aria-label={`Mastery for ${written}`}
      aria-valuenow={Math.round(to)} aria-valuemin={0} aria-valuemax={100}
      style={{ "--credit-from": `${from}%`, "--credit-to": `${to}%` }}><span /></div>
  </div>;
}

export function PracticeMasteryCredits({ credits, dismissCredit }) {
  return <div className="practice__credits" aria-live="polite" aria-relevant="additions" aria-label="Mastery feedback">
    {credits.map(credit => <MasteryCredit key={credit.id} credit={credit} onDismiss={dismissCredit} />)}
  </div>;
}

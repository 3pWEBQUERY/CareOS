"use client";

import { QUIZ_MAX_QUESTIONS, QUIZ_OPTIONS, type TrainingQuiz } from "@/lib/learning-shared";

export type QuizDraft = {
  enabled: boolean;
  passPercent: string;
  questions: Array<{ key: string; question: string; options: string[]; correct: number }>;
};

let draftKey = 0;
const newKey = () => `q${++draftKey}`;
const emptyQuestion = () => ({ key: newKey(), question: "", options: ["", ""], correct: 0 });

export function quizDraft(quiz: TrainingQuiz | null): QuizDraft {
  return {
    enabled: Boolean(quiz),
    passPercent: quiz ? String(quiz.passPercent) : "",
    questions: quiz
      ? quiz.questions.map((q) => ({
          key: newKey(),
          question: q.question,
          options: q.options,
          correct: q.correct ?? 0,
        }))
      : [emptyQuestion()],
  };
}

export function quizBody(draft: QuizDraft) {
  if (!draft.enabled) return null;
  return {
    passPercent: draft.passPercent ? Number(draft.passPercent) : null,
    questions: draft.questions.map(({ question, options, correct }) => ({ question, options, correct })),
  };
}

// Quiz zum Abschluss: Einzelauswahl, die Bestehensgrenze setzt die Einrichtung (kein Vorgabewert).
export function QuizEditor({ draft, onChange }: { draft: QuizDraft; onChange: (draft: QuizDraft) => void }) {
  const setQuestion = (index: number, patch: Partial<QuizDraft["questions"][number]>) =>
    onChange({
      ...draft,
      questions: draft.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    });
  return (
    <fieldset className="area-editor-wide duty-assignment-options learning-quiz-editor">
      <legend>Quiz zum Abschluss</legend>
      <div className="area-service-options">
        <label className={draft.enabled ? "selected" : ""}>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}
          />
          <span>Quiz verlangen</span>
        </label>
      </div>
      {draft.enabled && (
        <>
          <label className="learning-quiz-pass">
            <span>Bestehensgrenze (% richtige Antworten)</span>
            <input
              type="number"
              min={1}
              max={100}
              required
              value={draft.passPercent}
              onChange={(event) => onChange({ ...draft, passPercent: event.target.value })}
            />
          </label>
          <p className="list-hint">
            Wer die Grenze erreicht, hat die Schulung abgeschlossen; der Nachweis gilt ohne weitere Bestätigung.
          </p>
          {draft.questions.map((q, index) => (
            <div className="learning-quiz-question" key={q.key}>
              <label>
                <span>Frage {index + 1}</span>
                <input
                  value={q.question}
                  maxLength={1000}
                  required
                  onChange={(event) => setQuestion(index, { question: event.target.value })}
                />
              </label>
              {q.options.map((option, optionIndex) => (
                <div className="learning-quiz-option" key={optionIndex}>
                  <input
                    type="radio"
                    name={`${q.key}-correct`}
                    checked={q.correct === optionIndex}
                    aria-label={`Antwort ${optionIndex + 1} ist richtig`}
                    onChange={() => setQuestion(index, { correct: optionIndex })}
                  />
                  <input
                    value={option}
                    maxLength={300}
                    required
                    aria-label={`Frage ${index + 1}, Antwort ${optionIndex + 1}`}
                    onChange={(event) =>
                      setQuestion(index, {
                        options: q.options.map((o, i) => (i === optionIndex ? event.target.value : o)),
                      })
                    }
                  />
                  {q.options.length > QUIZ_OPTIONS.min && (
                    <button
                      className="quiet-button"
                      type="button"
                      onClick={() =>
                        setQuestion(index, {
                          options: q.options.filter((_, i) => i !== optionIndex),
                          correct: q.correct === optionIndex ? 0 : q.correct > optionIndex ? q.correct - 1 : q.correct,
                        })
                      }
                    >
                      Entfernen
                    </button>
                  )}
                </div>
              ))}
              <div className="learning-quiz-actions">
                {q.options.length < QUIZ_OPTIONS.max && (
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => setQuestion(index, { options: [...q.options, ""] })}
                  >
                    Antwort hinzufügen
                  </button>
                )}
                {draft.questions.length > 1 && (
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() => onChange({ ...draft, questions: draft.questions.filter((_, i) => i !== index) })}
                  >
                    Frage entfernen
                  </button>
                )}
              </div>
            </div>
          ))}
          {draft.questions.length < QUIZ_MAX_QUESTIONS && (
            <button
              className="quiet-button"
              type="button"
              onClick={() => onChange({ ...draft, questions: [...draft.questions, emptyQuestion()] })}
            >
              Frage hinzufügen
            </button>
          )}
          <p className="list-hint">Die richtige Antwort je Frage mit dem Punkt davor markieren.</p>
        </>
      )}
    </fieldset>
  );
}

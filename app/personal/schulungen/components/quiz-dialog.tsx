"use client";

import { useState } from "react";
import { EditorDialog, requestJson } from "@/app/components/workspace-ui";
import { type QuizResult, type Training } from "@/lib/learning-shared";

// Quiz ablegen. Bewertet wird auf dem Server; bei Nichtbestehen bleibt der Dialog offen für einen neuen Versuch,
// ohne zu verraten, welche Antworten falsch waren.
export function QuizDialog({
  training,
  onClose,
  onSaved,
  onAttempt,
}: {
  training: Training;
  onClose: () => void;
  onSaved: (message: string) => void;
  onAttempt: () => void;
}) {
  const quiz = training.quiz!;
  const [answers, setAnswers] = useState<Array<number | null>>(() => quiz.questions.map(() => null));
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState<QuizResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const open = answers.filter((answer) => answer === null).length;
  return (
    <EditorDialog
      id="learning-quiz"
      eyebrow="Schulungen · Quiz"
      title={training.title}
      description={`${quiz.questions.length} ${quiz.questions.length === 1 ? "Frage" : "Fragen"} · bestanden ab ${quiz.passPercent} % richtigen Antworten.`}
      onClose={onClose}
      onSubmit={async () => {
        if (open) {
          setError(`Bitte noch ${open} ${open === 1 ? "Frage" : "Fragen"} beantworten.`);
          return;
        }
        setSaving(true);
        setError("");
        try {
          const result = await requestJson<QuizResult>(`/api/learning/enrollments/${training.enrollment?.id}`, {
            method: "POST",
            body: { action: "quiz", answers },
          });
          if (result.passed) {
            onSaved(`Quiz bestanden (${result.percent} %) – Schulung abgeschlossen`);
            return;
          }
          setFailed(result);
          setAnswers(quiz.questions.map(() => null));
          setAttempt((current) => current + 1);
          setSaving(false);
          onAttempt();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Quiz konnte nicht ausgewertet werden.");
          setSaving(false);
        }
      }}
      saving={saving}
      error={error}
      submitLabel={failed ? "Erneut auswerten" : "Auswerten"}
    >
      {failed && (
        <p className="area-editor-wide learning-quiz-result" role="status">
          Nicht bestanden: {failed.correct} von {failed.total} richtig ({failed.percent} %), nötig sind{" "}
          {failed.passPercent} %. Du kannst es erneut versuchen.
        </p>
      )}
      {quiz.questions.map((q, index) => (
        <fieldset className="area-editor-wide learning-quiz-answer" key={`${attempt}-${q.id}`}>
          <legend>
            {index + 1}. {q.question}
          </legend>
          {q.options.map((option, optionIndex) => (
            <label className="learning-quiz-choice" key={optionIndex}>
              <input
                type="radio"
                name={`${attempt}-${q.id}`}
                checked={answers[index] === optionIndex}
                onChange={() =>
                  setAnswers((current) => current.map((answer, i) => (i === index ? optionIndex : answer)))
                }
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      ))}
    </EditorDialog>
  );
}

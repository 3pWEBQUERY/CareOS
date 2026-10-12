"use client";

import { useRouter } from "next/navigation";
import { setCareResident } from "@/app/components/care-context";
import { formatDate, formatDateTime, todayInZurich } from "@/app/components/workspace-ui";
import type { RecordView } from "./resident-record-data";
import type { ResidentRecordState } from "./use-resident-record";
import { useNow } from "@/app/components/use-now";

type StageState = "done" | "current" | "attention" | "open";
type Stage = {
  id: string;
  label: string;
  state: StageState;
  detail: string;
  view?: RecordView;
  href?: string;
};

const STATE_LABELS: Record<StageState, string> = {
  done: "Erledigt",
  current: "Aktueller Schritt",
  attention: "Handlungsbedarf",
  open: "Ausstehend",
};

// The care process of the resident at a glance: admission → assessment → planning →
// care delivery → evaluation. The first stage that is not done is the current step.
export function RecordCareProcess({ r }: { r: ResidentRecordState }) {
  const now = useNow();
  const { resident, live, latestAssessments, setActiveView, openDocumentation } = r;
  const router = useRouter();
  const summary = live.summary.data;
  const plan = live.care.data?.plan ?? null;
  if (!summary || !live.care.data) return null;

  const today = todayInZurich();
  const goals = (plan?.goals ?? []).filter((goal) => goal.status === "active");
  const evaluations = (plan?.goals ?? []).flatMap((goal) => goal.evaluations);
  const lastEvaluation = evaluations.sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt))[0] ?? null;
  const overdueAssessments = latestAssessments.filter((result) => result.nextDueOn && result.nextDueOn < today);
  const kompass = summary.kompass;
  const kompassOverdue = Boolean(kompass.dueOn && kompass.dueOn < today && kompass.inProgress === null);
  const lastDoc = live.docEntries[0] ?? null;
  const documentedRecently = lastDoc ? now - Date.parse(lastDoc.occurredAt) < 24 * 3_600_000 : false;
  const measures = goals.reduce(
    (sum, goal) => sum + goal.interventions.filter((item) => item.status === "active").length,
    0,
  );
  const evaluationDue = Boolean(plan?.reviewDue) || goals.some((goal) => goal.reviewDue);
  const nextReview = [plan?.reviewOn, ...goals.map((goal) => goal.targetDate)].filter(Boolean).sort()[0] ?? null;

  const stages: Stage[] = [
    {
      id: "admission",
      label: "Eintritt",
      state: summary.master.admittedOn && summary.master.primaryNurseId ? "done" : "attention",
      detail: !summary.master.admittedOn
        ? "Eintrittsdatum fehlt"
        : !summary.master.primaryNurseId
          ? "Bezugspflege fehlt"
          : `seit ${formatDate(summary.master.admittedOn)}`,
      view: "master-data",
    },
    {
      // Bedarfsabklärung mit dem Kompass und Einschätzungsinstrumente.
      id: "assessment",
      label: "Einschätzung",
      state:
        !latestAssessments.length && !kompass.lastOn
          ? "open"
          : overdueAssessments.length || kompassOverdue
            ? "attention"
            : "done",
      detail: kompassOverdue
        ? `Kompass fällig seit ${formatDate(kompass.dueOn ?? "")}`
        : kompass.inProgress !== null
          ? `Kompass begonnen · ${kompass.inProgress}%`
          : kompass.lastOn
            ? `Kompass ${formatDate(kompass.lastOn)}${kompass.needs.length ? ` · ${kompass.needs.length}× Bedarf` : ""}`
            : !latestAssessments.length
              ? "noch keine Einschätzung"
              : overdueAssessments.length
                ? `${overdueAssessments.length} überfällig`
                : `${latestAssessments.length} Instrument${latestAssessments.length === 1 ? "" : "e"} aktuell`,
      href: kompass.canOpen ? "/c/kompass/abklaerung" : "/c/einschaetzungen",
    },
    {
      id: "planning",
      label: "Planung",
      state: !plan ? "open" : goals.length ? "done" : "attention",
      detail: !plan
        ? "kein Pflegeplan"
        : goals.length
          ? `${goals.length} Ziel${goals.length === 1 ? "" : "e"} · ${measures} Massnahme${measures === 1 ? "" : "n"}`
          : "Pflegeplan ohne Ziele",
      view: "care-record",
    },
    {
      id: "delivery",
      label: "Durchführung",
      state: documentedRecently ? "done" : lastDoc ? "attention" : "open",
      detail: lastDoc
        ? `${documentedRecently ? "dokumentiert" : "zuletzt"} ${formatDateTime(lastDoc.occurredAt)}`
        : "noch nicht dokumentiert",
      view: "documentation",
    },
    {
      id: "evaluation",
      label: "Evaluation",
      state: evaluationDue ? "attention" : lastEvaluation ? "done" : "open",
      detail: evaluationDue
        ? "Evaluation fällig"
        : lastEvaluation
          ? `zuletzt ${formatDate(lastEvaluation.evaluatedAt)}${nextReview ? ` · nächste ${formatDate(nextReview)}` : ""}`
          : nextReview
            ? `geplant ${formatDate(nextReview)}`
            : "noch nicht geplant",
      href: `/c/pflegeplanung${resident.id ? `?resident=${resident.id}` : ""}`,
    },
  ];
  // The first stage not yet started is the current step; stages needing action stay marked.
  const firstOpen = stages.find((stage) => stage.state === "open");
  if (firstOpen) firstOpen.state = "current";
  const attention = stages.filter((stage) => stage.state === "attention").length;

  const open = (stage: Stage) => {
    if (stage.view === "documentation") openDocumentation();
    else if (stage.view) setActiveView(stage.view);
    else if (stage.href) {
      if (resident.id) setCareResident(resident.id);
      router.push(stage.href);
    }
  };

  return (
    <section className="record-card care-process" aria-label="Pflegeprozess">
      <div className="care-process-head">
        <span className="record-section-label">Pflegeprozess</span>
        <small>
          {attention
            ? `${attention} Schritt${attention === 1 ? "" : "e"} mit Handlungsbedarf`
            : firstOpen
              ? `Nächster Schritt: ${firstOpen.label}`
              : "Alle Schritte aktuell"}
        </small>
      </div>
      <ol className="care-process-steps">
        {stages.map((stage) => (
          <li key={stage.id}>
            <button
              className={`care-process-step ${stage.state}`}
              type="button"
              onClick={() => open(stage)}
              title={`${stage.label}: ${STATE_LABELS[stage.state]} – ${stage.detail}`}
            >
              <strong>{stage.label}</strong>
              <small>{stage.detail}</small>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

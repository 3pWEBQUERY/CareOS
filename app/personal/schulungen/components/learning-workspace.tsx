"use client";

import { useCallback, useRef, useState } from "react";
import { type LearningPayload } from "@/lib/learning-shared";
import { PersonalFrame } from "../../components/personal-ui";
import { Dialog } from "./learning-utils";
import { LearningView } from "./learning-view";

export default function LearningWorkspace({ compliance }: { compliance: boolean }) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [canManage, setCanManage] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const onData = useCallback((data: LearningPayload | undefined) => setCanManage(Boolean(data?.canManage)), []);
  return (
    <PersonalFrame
      module="learn"
      child={compliance ? "Pflichtnachweise" : "Meine Schulungen"}
      view={compliance ? "compliance" : "learning"}
      eyebrow="Schulungen"
      title={compliance ? "Pflichtnachweise" : "Meine Schulungen"}
      description={
        compliance
          ? "Kompetenzen und Nachweise für einen sicheren Pflegealltag."
          : "Dein Lernplan, Fortschritt und anstehende Weiterbildungen."
      }
      action={
        compliance
          ? {
              label: "Nachweis erfassen",
              onClick: () => setDialog({ kind: "evidence", trainingId: null, userId: null }),
            }
          : canManage
            ? { label: "Schulung anlegen", onClick: () => setDialog({ kind: "training", training: null }) }
            : {
                label: "Schulung suchen",
                icon: "search",
                onClick: () => {
                  searchRef.current?.scrollIntoView({ block: "center" });
                  searchRef.current?.querySelector("input")?.focus();
                },
              }
      }
    >
      {(showToast) => (
        <LearningView
          compliance={compliance}
          showToast={showToast}
          dialog={dialog}
          setDialog={setDialog}
          onData={onData}
          searchRef={searchRef}
        />
      )}
    </PersonalFrame>
  );
}

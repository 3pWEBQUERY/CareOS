"use client";

import { Suspense, useCallback, useState } from "react";
import { type DocumentKind, type DocumentsPayload } from "@/lib/documents-shared";
import { PersonalFrame } from "../../components/personal-ui";
import { Dialog } from "./documents-utils";
import { DocumentsView } from "./documents-view";

export default function DocumentsWorkspace({ kind }: { kind: DocumentKind }) {
  const standards = kind === "standard";
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [canUpload, setCanUpload] = useState(false);
  const onData = useCallback((data: DocumentsPayload | undefined) => setCanUpload(Boolean(data?.canUpload)), []);
  return (
    <PersonalFrame
      module="docs"
      child={standards ? "Standards & Weisungen" : "Dokumente"}
      view={standards ? "standards" : "documents"}
      eyebrow="Dokumente"
      title={standards ? "Standards & Weisungen" : "Dokumente"}
      description={
        standards
          ? "Aktuelle Standards, Weisungen und Versionen im schnellen Zugriff."
          : "Zentrale Ablage für Formulare, Vorlagen und Arbeitsunterlagen."
      }
      action={
        canUpload
          ? {
              label: standards ? "Weisung veröffentlichen" : "Dokument hochladen",
              onClick: () => setDialog({ kind: "upload" }),
            }
          : null
      }
    >
      {(showToast) => (
        // DocumentsView reads ?document= (useSearchParams), which needs a Suspense boundary on a static page.
        <Suspense fallback={null}>
          <DocumentsView kind={kind} showToast={showToast} dialog={dialog} setDialog={setDialog} onData={onData} />
        </Suspense>
      )}
    </PersonalFrame>
  );
}

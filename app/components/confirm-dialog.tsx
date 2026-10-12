"use client";

import { useCallback, useState } from "react";
import { EditorDialog } from "./workspace-ui";

export type Confirm = (options: ConfirmRequest) => Promise<boolean>;
type ConfirmRequest = { title: string; message: string; confirmLabel: string; eyebrow?: string };

// Bestätigung im CareOS-Dialog statt window.confirm: `await confirm({...})` liefert true oder false.
export function useConfirmDialog() {
  const [request, setRequest] = useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm: Confirm = useCallback(
    (options: ConfirmRequest) => new Promise<boolean>((resolve) => setRequest({ ...options, resolve })),
    [],
  );
  const finish = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };
  const confirmDialog = request ? (
    <EditorDialog
      id="confirm-dialog"
      eyebrow={request.eyebrow ?? "CareOS · Bestätigung"}
      title={request.title}
      description={request.message}
      onClose={() => finish(false)}
      onSubmit={() => finish(true)}
      saving={false}
      error=""
      submitLabel={request.confirmLabel}
      danger
    >
      {null}
    </EditorDialog>
  ) : null;
  return { confirm, confirmDialog };
}

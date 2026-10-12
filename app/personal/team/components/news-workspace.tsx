"use client";

import { Suspense, useCallback, useState } from "react";
import { type TeamNewsPayload } from "@/lib/team-news-shared";
import { PersonalFrame } from "../../components/personal-ui";
import { Dialog } from "./news-utils";
import { NewsView } from "./news-view";

export default function NewsWorkspace() {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [canPost, setCanPost] = useState(false);
  const onData = useCallback(
    (data: TeamNewsPayload | undefined) => setCanPost(Boolean(data?.channels.some((c) => c.canPost))),
    [],
  );
  return (
    <PersonalFrame
      module="team"
      child="Neuigkeiten & Kanäle"
      view="teamNews"
      eyebrow="Team"
      title="Neuigkeiten & Kanäle"
      description="Updates, Absprachen und Fachdialoge im gesamten Haus."
      action={canPost ? { label: "Beitrag erstellen", onClick: () => setDialog({ kind: "post", post: null }) } : null}
    >
      {(showToast) => (
        // NewsView reads ?post= (useSearchParams), which needs a Suspense boundary on a static page.
        <Suspense fallback={null}>
          <NewsView showToast={showToast} dialog={dialog} setDialog={setDialog} onData={onData} />
        </Suspense>
      )}
    </PersonalFrame>
  );
}

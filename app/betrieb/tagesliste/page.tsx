"use client";

import ModulePageShell from "@/app/components/module-page-shell";
import { PageHeading } from "@/app/components/workspace-ui";
import { WorklistCard } from "../components/worklist-card";

// Tagesliste: alles, was heute je Bewohner fällig ist – nach Kritisch, Wichtig und Routine.
export default function WorklistPage() {
  return (
    <ModulePageShell activeModule="shift" activeChild="Tagesliste" pageClass="operations-page operations-worklist">
      {() => (
        <main className="workspace module-workspace operations-command-workspace">
          <PageHeading
            eyebrow="Mein Dienst"
            title="Tagesliste"
            description="Was heute fällig ist – je Bewohner, nach Kritisch, Wichtig und Routine. Ein Klick führt direkt zur Erfassung."
          />
          <WorklistCard />
        </main>
      )}
    </ModulePageShell>
  );
}

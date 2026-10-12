// Allergiehinweis zu einer Person: nicht erfasst, keine bekannt oder die erfassten Allergien.
export function AllergyBadge({ allergies }: { allergies: string | null }) {
  if (allergies === null) return <span className="status-badge attention">Allergien nicht erfasst</span>;
  const none = /^(keine|keine bekannt|nicht bekannt)$/i.test(allergies.trim());
  return (
    <span className={`status-badge ${none ? "stable" : "critical"}`} title={allergies}>
      Allergien: {allergies}
    </span>
  );
}

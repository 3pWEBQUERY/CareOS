"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ModulePageShell from "@/app/components/module-page-shell";
import { type ModuleIconName } from "@/app/components/module-icon";
import { ModuleIcon } from "@/app/components/module-icon";
import {
  NOTIFICATION_CLASSES,
  bundleNotifications,
  notificationClass,
  type NotificationClass,
} from "@/lib/notification-classes";

type Filter = "Alle" | "Ungelesen" | NotificationClass;
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "Alle", label: "Alle" },
  { value: "Ungelesen", label: "Ungelesen" },
  { value: "critical", label: "Kritisch" },
  { value: "action", label: "Handlung" },
  { value: "info", label: "Info" },
  { value: "social", label: "Sozial" },
];
const dayOf = (value: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(value));
type Item = {
  id: string;
  title: string;
  body: string | null;
  type: string;
  priority: string;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
};

function appearance(item: Item): { icon: ModuleIconName; tone: string; category: string } {
  const kind = NOTIFICATION_CLASSES[notificationClass(item.type, item.priority)];
  return { icon: kind.icon, tone: kind.tone, category: kind.label };
}

const stamp = (value: string) =>
  new Date(value).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<Filter>("Alle");
  const [error, setError] = useState("");
  const [openBundles, setOpenBundles] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    fetch("/api/notifications", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Benachrichtigungen konnten nicht geladen werden.");
        if (active) setItems(data.notifications);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Laden fehlgeschlagen.");
      });
    return () => {
      active = false;
    };
  }, []);
  const unread = items.filter((item) => !item.read_at).length;
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          filter === "Alle" ||
          (filter === "Ungelesen" ? !item.read_at : notificationClass(item.type, item.priority) === filter),
      ),
    [filter, items],
  );
  const entries = useMemo(() => bundleNotifications(visible, dayOf), [visible]);
  const counts = useMemo(() => {
    const result: Record<NotificationClass, number> = { critical: 0, action: 0, info: 0, social: 0 };
    for (const item of items) if (!item.read_at) result[notificationClass(item.type, item.priority)] += 1;
    return result;
  }, [items]);
  async function markRead(ids?: string[]) {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids ? (ids.length === 1 ? { id: ids[0] } : { ids }) : { all: true }),
    });
    if (!response.ok) throw new Error("Lesestatus konnte nicht gespeichert werden.");
    const now = new Date().toISOString();
    setItems((current) =>
      current.map((item) => (!ids || ids.includes(item.id) ? { ...item, read_at: item.read_at || now } : item)),
    );
  }

  return (
    <ModulePageShell pageClass="notifications-page" locationSecondary="Persönlicher Bereich">
      {(showToast) => {
        const renderRow = (item: Item) => {
          const ui = appearance(item);
          return (
            <button
              className={`notifications-page-row ${item.read_at ? "read" : "unread"}`}
              type="button"
              key={item.id}
              onClick={() =>
                void markRead([item.id])
                  .then(() => {
                    if (item.link_url?.startsWith("/c/")) router.push(item.link_url);
                    else showToast(`${item.title} geöffnet`);
                  })
                  .catch((cause) => setError(cause.message))
              }
            >
              <span className={`notifications-page-icon ${ui.tone}`}>
                <ModuleIcon name={ui.icon} />
              </span>
              <span className="notifications-page-copy">
                <span className="notifications-page-category">{ui.category}</span>
                <strong>{item.title}</strong>
                <small>{item.body}</small>
              </span>
              <span className="notifications-page-meta">
                {!item.read_at && <span className="notification-unread" aria-label="Ungelesen" />}
                <time>{stamp(item.created_at)}</time>
                <ModuleIcon name="chevron" />
              </span>
            </button>
          );
        };
        return (
          <main className="workspace notifications-workspace">
            <section className="page-heading notifications-page-heading">
              <div className="heading-copy">
                <p className="eyebrow">Benachrichtigungen</p>
                <h1>Benachrichtigungen</h1>
                <p>Alle relevanten Hinweise für deinen Arbeitsbereich an einem Ort.</p>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={!unread}
                onClick={() =>
                  void markRead()
                    .then(() => showToast("Alle Benachrichtigungen als gelesen markiert"))
                    .catch((cause) => setError(cause.message))
                }
              >
                <ModuleIcon name="check" />
                Alle gelesen
              </button>
            </section>
            <section className="summary-strip notifications-summary">
              <div className="summary-item">
                <span className="summary-icon">
                  <ModuleIcon name="bell" />
                </span>
                <span>
                  <strong className="summary-value">{items.length}</strong>
                  <small className="summary-label">Hinweise gesamt</small>
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-icon attention">
                  <ModuleIcon name="alert" />
                </span>
                <span>
                  <strong className="summary-value">{unread}</strong>
                  <small className="summary-label">Ungelesen</small>
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-icon critical">
                  <ModuleIcon name="quality" />
                </span>
                <span>
                  <strong className="summary-value">{counts.critical + counts.action}</strong>
                  <small className="summary-label">Kritisch oder Handlung nötig</small>
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-icon info">
                  <ModuleIcon name="calendar" />
                </span>
                <span>
                  <strong className="summary-value">
                    {
                      items.filter((item) => new Date(item.created_at).toDateString() === new Date().toDateString())
                        .length
                    }
                  </strong>
                  <small className="summary-label">Heute eingegangen</small>
                </span>
              </div>
            </section>
            <section className="card notifications-inbox">
              <div className="card-header notifications-inbox-header">
                <div>
                  <p className="eyebrow">Posteingang</p>
                  <h2 className="card-title">Deine Hinweise</h2>
                  <p className="card-subtitle">
                    {visible.length} von {items.length} Benachrichtigungen
                  </p>
                </div>
                <div className="notifications-filter-bar" role="group" aria-label="Benachrichtigungen filtern">
                  {FILTERS.map((option) => {
                    const badge =
                      option.value === "Ungelesen"
                        ? unread
                        : option.value === "Alle"
                          ? 0
                          : counts[option.value as NotificationClass];
                    return (
                      <button
                        className={filter === option.value ? "active" : ""}
                        type="button"
                        key={option.value}
                        aria-pressed={filter === option.value}
                        onClick={() => setFilter(option.value)}
                      >
                        {option.label}
                        {(option.value === "Ungelesen" || badge > 0) && <span>{badge}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="notifications-page-list">
                {error && <p role="alert">{error}</p>}
                {entries.map((entry) => {
                  if (entry.kind === "single") return renderRow(entry.item);
                  const open = openBundles.includes(entry.key);
                  const unreadIds = entry.items.filter((item) => !item.read_at).map((item) => item.id);
                  const ui = appearance(entry.items[0]);
                  return (
                    <div className="notifications-bundle" key={entry.key}>
                      <button
                        className={`notifications-page-row ${unreadIds.length ? "unread" : "read"}`}
                        type="button"
                        aria-expanded={open}
                        onClick={() =>
                          setOpenBundles((current) =>
                            open ? current.filter((key) => key !== entry.key) : [...current, entry.key],
                          )
                        }
                      >
                        <span className={`notifications-page-icon ${ui.tone}`}>
                          <ModuleIcon name={ui.icon} />
                        </span>
                        <span className="notifications-page-copy">
                          <span className="notifications-page-category">{ui.category} · gebündelt</span>
                          <strong>
                            {entry.items.length} × {entry.label}
                          </strong>
                          <small>
                            {unreadIds.length ? `${unreadIds.length} ungelesen · ` : ""}
                            {open ? "Einzelne Hinweise ausblenden" : "Einzelne Hinweise anzeigen"}
                          </small>
                        </span>
                        <span className="notifications-page-meta">
                          {unreadIds.length > 0 && <span className="notification-unread" aria-label="Ungelesen" />}
                          <time>{stamp(entry.items[0].created_at)}</time>
                          <ModuleIcon name="chevron" />
                        </span>
                      </button>
                      {open && (
                        <div className="notifications-bundle-items">
                          {entry.items.map(renderRow)}
                          {unreadIds.length > 0 && (
                            <button
                              className="secondary-button"
                              type="button"
                              onClick={() =>
                                void markRead(unreadIds)
                                  .then(() => showToast(`${unreadIds.length} Hinweise als gelesen markiert`))
                                  .catch((cause) => setError(cause.message))
                              }
                            >
                              <ModuleIcon name="check" />
                              Alle {unreadIds.length} als gelesen markieren
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!visible.length && !error && (
                  <div className="notifications-empty">
                    <ModuleIcon name="check" />
                    <strong>Keine passenden Benachrichtigungen</strong>
                    <p>In diesem Filter sind aktuell keine Hinweise vorhanden.</p>
                  </div>
                )}
              </div>
            </section>
          </main>
        );
      }}
    </ModulePageShell>
  );
}

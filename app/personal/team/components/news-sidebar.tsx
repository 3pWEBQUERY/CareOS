"use client";

import { ModuleIcon } from "@/app/components/module-icon";
import { personInitials } from "@/lib/tasks-shared";
import type { NewsViewState } from "./use-news-view";

export function NewsSidebar({ r }: { r: NewsViewState }) {
  const { setDialog, channelId, setChannelId, data, run, channels } = r;
  return (
    <aside className="team-side-stack">
      <section className="card team-channels-card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Arbeitsbereich</p>
            <h2 className="card-title">Kanäle</h2>
          </div>
          {data?.canManage && (
            <button className="quiet-button" type="button" onClick={() => setDialog({ kind: "channel" })}>
              <ModuleIcon name="plus" /> Kanal
            </button>
          )}
        </div>
        <ul>
          {channels.map((channel) => (
            <li key={channel.id} className={channel.id === channelId ? "active" : ""}>
              <span className={`team-channel-dot ${channel.color}`} />
              <button type="button" className="team-channel-open" onClick={() => setChannelId(channel.id)}>
                <strong>{channel.name}</strong>
                <small>
                  {channel.members} {channel.members === 1 ? "Mitglied" : "Mitglieder"}
                  {channel.joined
                    ? channel.unread
                      ? ` · ${channel.unread} neu`
                      : " · aktuell"
                    : " · nicht beigetreten"}
                </small>
              </button>
              {channel.joined ? (
                <ModuleIcon name="chevron" />
              ) : (
                <button
                  type="button"
                  className="team-channel-join"
                  onClick={() =>
                    void run(
                      `/api/team-news/channels/${channel.id}`,
                      { action: "join" },
                      `„${channel.name}“ beigetreten`,
                    )
                  }
                >
                  Beitreten
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="card team-duty-card">
        <div className="card-header">
          <div>
            <p className="eyebrow">Jetzt</p>
            <h2 className="card-title">Im Dienst</h2>
          </div>
          <span className="status-badge stable">
            {(data?.onDuty ?? []).filter((person) => person.state === "present").length} aktiv
          </span>
        </div>
        <div className="team-duty-list">
          {(data?.onDuty ?? []).map((person) => (
            <DutyRow
              key={person.userId}
              name={person.name}
              detail={person.detail}
              present={person.state === "present"}
            />
          ))}
        </div>
        {data && !data.onDuty.length && <p className="list-hint team-duty-empty">Gerade ist niemand eingecheckt.</p>}
      </section>
    </aside>
  );
}

export function DutyRow({ name, detail, present }: { name: string; detail: string; present: boolean }) {
  return (
    <>
      <span className="avatar">{personInitials(name)}</span>
      <span>
        <strong>{name}</strong>
        <small>{detail || "Dienst"}</small>
      </span>
      <span className={`team-duty-state ${present ? "" : "planned"}`}>{present ? "Im Dienst" : "Geplant"}</span>
    </>
  );
}

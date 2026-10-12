"use client";

import { useTerms } from "@/app/components/care-context";
import { Check, NotePencil, User } from "@phosphor-icons/react";
import type { ResidentRecordState } from "./use-resident-record";

export function RecordBiographyView({ r }: { r: ResidentRecordState }) {
  const t = useTerms();
  const {
    resident,
    contentRef,
    biography,
    setBiography,
    biographyEditing,
    setBiographyEditing,
    biographyLoading,
    biographySaving,
    biographyError,
    setBiographyError,
    saveBiography,
  } = r;
  return (
    <main className="resident-record-content biography-view" ref={contentRef} key="biography">
      <div className="record-subpage-heading biography-heading">
        <div>
          <span className="record-section-label">{`${t.prefix}akte`}</span>
          <h3>Biografie</h3>
          <p>
            Was {resident.name} geprägt hat, stärkt und im Alltag wichtig ist – für eine persönliche, respektvolle
            Pflege.
          </p>
        </div>
        <div className="biography-heading-actions">
          {biographyEditing && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setBiographyEditing(false);
                setBiographyError("");
              }}
            >
              Abbrechen
            </button>
          )}
          <button
            className="primary-button"
            type="button"
            disabled={biographyLoading || biographySaving}
            onClick={() => (biographyEditing ? void saveBiography() : setBiographyEditing(true))}
          >
            {biographyEditing ? (
              <>
                <Check aria-hidden="true" /> {biographySaving ? "Speichern…" : "Biografie speichern"}
              </>
            ) : (
              <>
                <NotePencil aria-hidden="true" /> Biografie bearbeiten
              </>
            )}
          </button>
        </div>
      </div>

      <section className="biography-intro" aria-label="Hinweis zur Biografie">
        <span>
          <User aria-hidden="true" />
        </span>
        <div>
          <strong>Personzentriert begleiten</strong>
          <p>
            Biografische Angaben werden nur für die Betreuung und Pflege verwendet. Ergänze nur Informationen, die für
            den Alltag des {t.oneGenitive} hilfreich sind.
          </p>
        </div>
        <small>
          {biography.updatedAt
            ? `Zuletzt gepflegt ${new Intl.DateTimeFormat("de-CH", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(biography.updatedAt))}${biography.updatedBy ? ` · ${biography.updatedBy}` : ""}`
            : "Noch nicht dokumentiert"}
        </small>
      </section>

      {biographyError && (
        <div className="biography-error" role="alert">
          {biographyError}
        </div>
      )}
      {biographyLoading ? (
        <div className="biography-loading">Biografie wird geladen…</div>
      ) : (
        <div className={`biography-layout ${biographyEditing ? "is-editing" : ""}`}>
          <section className="record-card biography-story-card">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Lebensweg</span>
                <h3>Meine Geschichte</h3>
              </div>
              <span>{biography.lifeStory ? "Hinterlegt" : "Noch offen"}</span>
            </div>
            {biographyEditing ? (
              <label className="biography-field">
                <span>Lebensgeschichte</span>
                <textarea
                  value={biography.lifeStory}
                  onChange={(event) => setBiography((current) => ({ ...current, lifeStory: event.target.value }))}
                  placeholder="Wichtige Lebensstationen, Herkunft, Beruf, Familie und prägende Erlebnisse …"
                  rows={10}
                />
              </label>
            ) : (
              <div className="biography-reading">
                <p>
                  {biography.lifeStory ||
                    `Noch keine Lebensgeschichte hinterlegt. Ergänze sie gemeinsam mit dem ${t.oneOblique} oder seinen Angehörigen.`}
                </p>
              </div>
            )}
          </section>

          <aside className="biography-side">
            <section className="record-card biography-facts-card">
              <div className="record-card-heading">
                <div>
                  <span className="record-section-label">Persönliches Umfeld</span>
                  <h3>Wichtige Menschen</h3>
                </div>
              </div>
              {biographyEditing ? (
                <label className="biography-field">
                  <span>Familie, Freunde und Bezugspersonen</span>
                  <textarea
                    value={biography.importantPeople}
                    onChange={(event) =>
                      setBiography((current) => ({ ...current, importantPeople: event.target.value }))
                    }
                    placeholder="z. B. Angehörige, enge Freundschaften, wichtige Beziehungen …"
                    rows={6}
                  />
                </label>
              ) : (
                <div className="biography-reading compact">
                  <p>{biography.importantPeople || "Noch keine Bezugspersonen beschrieben."}</p>
                </div>
              )}
            </section>
            <section className="record-card biography-facts-card">
              <div className="record-card-heading">
                <div>
                  <span className="record-section-label">Ressourcen</span>
                  <h3>Stärken &amp; Interessen</h3>
                </div>
              </div>
              {biographyEditing ? (
                <label className="biography-field">
                  <span>Interessen, Fähigkeiten und Ressourcen</span>
                  <textarea
                    value={biography.strengths}
                    onChange={(event) => setBiography((current) => ({ ...current, strengths: event.target.value }))}
                    placeholder="z. B. Musik, Garten, Handwerk, Gespräche oder liebgewonnene Fähigkeiten …"
                    rows={6}
                  />
                </label>
              ) : (
                <div className="biography-reading compact">
                  <p>{biography.strengths || "Noch keine Ressourcen beschrieben."}</p>
                </div>
              )}
            </section>
          </aside>

          <section className="record-card biography-daily-card">
            <div className="record-card-heading">
              <div>
                <span className="record-section-label">Alltag</span>
                <h3>Gewohnheiten und Vorlieben</h3>
              </div>
            </div>
            <div className="biography-daily-grid">
              <div>
                {biographyEditing ? (
                  <label className="biography-field">
                    <span>Gewohnheiten &amp; Rituale</span>
                    <textarea
                      value={biography.dailyRoutines}
                      onChange={(event) =>
                        setBiography((current) => ({ ...current, dailyRoutines: event.target.value }))
                      }
                      placeholder="Tagesstruktur, Morgen- oder Abendrituale, Gewohnheiten …"
                      rows={6}
                    />
                  </label>
                ) : (
                  <>
                    <span>Gewohnheiten &amp; Rituale</span>
                    <p>{biography.dailyRoutines || "Noch keine Gewohnheiten dokumentiert."}</p>
                  </>
                )}
              </div>
              <div>
                {biographyEditing ? (
                  <label className="biography-field">
                    <span>Vorlieben &amp; Abneigungen</span>
                    <textarea
                      value={biography.preferences}
                      onChange={(event) => setBiography((current) => ({ ...current, preferences: event.target.value }))}
                      placeholder="Essen, Musik, Ansprache, Beschäftigungen und persönliche Vorlieben …"
                      rows={6}
                    />
                  </label>
                ) : (
                  <>
                    <span>Vorlieben &amp; Abneigungen</span>
                    <p>{biography.preferences || "Noch keine Vorlieben dokumentiert."}</p>
                  </>
                )}
              </div>
              <div className="biography-sensitive">
                {biographyEditing ? (
                  <label className="biography-field">
                    <span>Sensible Themen</span>
                    <textarea
                      value={biography.sensitiveTopics}
                      onChange={(event) =>
                        setBiography((current) => ({ ...current, sensitiveTopics: event.target.value }))
                      }
                      placeholder="Themen, Situationen oder Auslöser, die besonders achtsam behandelt werden sollen …"
                      rows={6}
                    />
                  </label>
                ) : (
                  <>
                    <span>Sensible Themen</span>
                    <p>{biography.sensitiveTopics || "Keine sensiblen Themen hinterlegt."}</p>
                  </>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

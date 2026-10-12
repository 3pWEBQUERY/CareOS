"use client";

import { type RefObject } from "react";
import { ModuleIcon } from "./module-icon";
import { notificationStyle } from "./header-parts";
import type { AppHeaderState } from "./use-app-header";

export function HeaderNotificationMenu({
  r,
  ref,
  compact = false,
}: {
  r: AppHeaderState;
  ref: RefObject<HTMLDivElement | null>;
  compact?: boolean;
}) {
  const {
    onToast,
    router,
    setProfileOpen,
    notificationOpen,
    setNotificationOpen,
    setLocationOpen,
    headerNotifications,
    unreadNotifications,
    markNotificationRead,
  } = r;
  return (
    <div className={`notification-menu-wrap ${compact ? "mobile-notification-menu-wrap" : ""}`} ref={ref}>
      <button
        className={`icon-button notification-trigger ${notificationOpen ? "open" : ""}`}
        type="button"
        aria-label="Benachrichtigungen öffnen"
        aria-haspopup="menu"
        aria-expanded={notificationOpen}
        onClick={() => {
          setProfileOpen(false);
          setLocationOpen(false);
          setNotificationOpen((value) => !value);
        }}
      >
        <ModuleIcon name="bell" />
        {unreadNotifications > 0 && <span className="notification-dot" />}
      </button>
      {notificationOpen && (
        <div className="notification-dropdown" role="menu">
          <div className="notification-dropdown-header">
            <div>
              <p className="eyebrow">Posteingang</p>
              <strong>Benachrichtigungen</strong>
            </div>
            <div className="notification-header-actions">
              <span className="notification-count">{unreadNotifications} neu</span>
              <button
                type="button"
                onClick={() =>
                  void markNotificationRead().then((ok) => {
                    if (ok) onToast("Alle Benachrichtigungen als gelesen markiert");
                  })
                }
              >
                Alle gelesen
              </button>
            </div>
          </div>
          <div className="notification-list">
            {headerNotifications.slice(0, 5).map((item) => {
              const style = notificationStyle(item);
              return (
                <button
                  className="notification-item"
                  type="button"
                  role="menuitem"
                  key={item.id}
                  onClick={() =>
                    void markNotificationRead(item.id).then((ok) => {
                      if (!ok) return;
                      setNotificationOpen(false);
                      if (item.link_url?.startsWith("/c/")) router.push(item.link_url);
                      else onToast(`${item.title} geöffnet`);
                    })
                  }
                >
                  <span className={`notification-item-icon ${style.tone}`}>
                    <ModuleIcon name={style.icon} />
                  </span>
                  <span className="notification-item-copy">
                    <strong>{item.title}</strong>
                    <small>{item.body}</small>
                  </span>
                  <span className="notification-item-meta">
                    {!item.read_at && <span className="notification-unread" />}
                    <time>{new Date(item.created_at).toLocaleDateString("de-CH")}</time>
                  </span>
                </button>
              );
            })}
            {headerNotifications.length === 0 && <p>Keine Benachrichtigungen vorhanden.</p>}
          </div>
          <div className="notification-dropdown-footer">
            <button
              type="button"
              onClick={() => {
                setNotificationOpen(false);
                router.push("/c/benachrichtigungen");
              }}
            >
              Alle Benachrichtigungen
              <ModuleIcon name="chevron" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

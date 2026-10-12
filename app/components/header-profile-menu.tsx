"use client";

import { type RefObject } from "react";
import { ModuleIcon } from "./module-icon";
import { initials } from "./header-parts";
import type { AppHeaderState } from "./use-app-header";

export function HeaderProfileMenu({
  r,
  ref,
  compact = false,
}: {
  r: AppHeaderState;
  ref: RefObject<HTMLDivElement | null>;
  compact?: boolean;
}) {
  const {
    router,
    context,
    profileOpen,
    setProfileOpen,
    setProfilePopoverOpen,
    setNotificationOpen,
    setLocationOpen,
    logout,
  } = r;
  const profile = context?.profile;
  return (
    <div className={`profile-menu-wrap ${compact ? "mobile-profile-menu-wrap" : ""}`} ref={ref}>
      <button
        className={`profile profile-trigger ${compact ? "mobile-profile-trigger" : ""} ${profileOpen ? "open" : ""}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={profileOpen}
        aria-label={compact ? "Profilmenü öffnen" : undefined}
        onClick={() => {
          setNotificationOpen(false);
          setLocationOpen(false);
          setProfileOpen((value) => !value);
        }}
      >
        <span className="avatar">{profile ? initials(profile.displayName) : "…"}</span>
        {!compact && (
          <span>
            <small>{profile?.jobTitle ?? "…"}</small>
            <strong>{profile?.displayName ?? "Wird geladen"}</strong>
          </span>
        )}
        <ModuleIcon name="caretDown" className="profile-caret" />
      </button>
      {profileOpen && (
        <div className="profile-dropdown" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setProfileOpen(false);
              setProfilePopoverOpen(true);
            }}
          >
            <span className="profile-menu-icon">
              <ModuleIcon name="team" />
            </span>
            <span>Mein Profil</span>
            <ModuleIcon name="chevron" className="profile-menu-chevron" />
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setProfileOpen(false);
              router.push("/c/mein-dienstplan");
            }}
          >
            <span className="profile-menu-icon">
              <ModuleIcon name="calendar" />
            </span>
            <span>Dienste</span>
            <ModuleIcon name="chevron" className="profile-menu-chevron" />
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setProfileOpen(false);
              router.push("/c/carecore-one/messenger");
            }}
          >
            <span className="profile-menu-icon">
              <ModuleIcon name="team" />
            </span>
            <span>Nachrichten</span>
            <ModuleIcon name="chevron" className="profile-menu-chevron" />
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setProfileOpen(false);
              router.push("/c/einstellungen");
            }}
          >
            <span className="profile-menu-icon">
              <ModuleIcon name="settings" />
            </span>
            <span>Einstellungen</span>
            <ModuleIcon name="chevron" className="profile-menu-chevron" />
          </button>
          <button className="logout" type="button" role="menuitem" onClick={logout}>
            <span className="profile-menu-icon">
              <ModuleIcon name="logout" />
            </span>
            <span>Ausloggen</span>
          </button>
        </div>
      )}
    </div>
  );
}

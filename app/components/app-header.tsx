"use client";

import type { ReactNode } from "react";
import { ModuleIcon } from "./module-icon";
import { Pulse } from "@phosphor-icons/react";
import { openAppLauncher } from "./app-launcher";
import { Dock, HomeButton, MenubarClock } from "./top-navigation";
import { ProfilePopover } from "./header-profile-popover";
import { ResidentPickerPopover } from "./header-resident-picker";
import { useAppHeader } from "./use-app-header";
import { HeaderResidentSelector } from "./header-resident-selector";
import { HeaderLocationControl } from "./header-location-control";
import { HeaderProfileMenu } from "./header-profile-menu";
import { HeaderNotificationMenu } from "./header-notification-menu";
import { KeyboardShortcutsMenu } from "./keyboard-shortcuts";
import { HeaderAiButton } from "./header-ai-panel";
import { PersonalAppearance } from "./appearance";
import { IdleLogout } from "./idle-logout";
import { HelpPanel } from "./help-panel";

export default function AppHeader(props: {
  activeModule?: string;
  activeChild?: string;
  // Kopf der geöffneten App (Name und Reiter): am Computer in der Menüleiste, auf dem Handy unter der Kopfzeile.
  appBar?: ReactNode;
  locationPrimary?: string;
  locationSecondary?: string;
  searchOpen: boolean;
  onSearch: () => void;
  onToast: (message: string) => void;
}) {
  const r = useAppHeader(props);
  const {
    searchOpen,
    onSearch,
    onToast,
    context,
    setContext,
    profilePopoverOpen,
    setProfilePopoverOpen,
    selectedAreaId,
    setSelectedAreaId,
    residentOpen,
    setResidentOpen,
    selectedResident,
    profileMenuRef,
    mobileProfileMenuRef,
    notificationMenuRef,
    mobileNotificationMenuRef,
    locationMenuRef,
    mobileLocationMenuRef,
    closeMenus,
    chooseResident,
  } = r;
  return (
    <>
      <PersonalAppearance />
      <IdleLogout />
      <HelpPanel />
      <header className="topbar menubar">
        <div className="menubar-start">
          <button
            className="menubar-logo"
            type="button"
            aria-label="Alle Apps"
            aria-haspopup="dialog"
            title="Alle Apps"
            onClick={openAppLauncher}
          >
            <Pulse weight="bold" />
          </button>
          {props.appBar ?? (
            <span className="menubar-app">
              <strong>{props.activeModule === "settings" ? "Einstellungen" : "CareOS"}</strong>
            </span>
          )}
        </div>
        <div className="menubar-status">
          <HeaderLocationControl r={r} ref={locationMenuRef} />
          <HeaderResidentSelector r={r} />
          <span className="menubar-separator" aria-hidden="true" />
          <button
            className="icon-button search-trigger"
            type="button"
            onClick={() => {
              closeMenus();
              onSearch();
            }}
            aria-label="Suchen (⌘ K)"
            title="Suchen (⌘ K)"
            aria-expanded={searchOpen}
          >
            <ModuleIcon name="search" />
          </button>
          <HeaderAiButton />
          <KeyboardShortcutsMenu />
          <HeaderNotificationMenu r={r} ref={notificationMenuRef} />
          <MenubarClock />
          <HeaderProfileMenu r={r} ref={profileMenuRef} />
        </div>
      </header>
      <Dock activeModule={props.activeModule} activeChild={props.activeChild} />
      <header className="mobile-top">
        <HomeButton active={props.activeModule === "home"} />
        <div className="mobile-actions">
          <HeaderLocationControl r={r} ref={mobileLocationMenuRef} compact={true} />
          <HeaderResidentSelector r={r} compact={true} />
          <button className="icon-button" type="button" aria-label="Suche öffnen" onClick={onSearch}>
            <ModuleIcon name="search" />
          </button>
          <HeaderAiButton />
          <HeaderNotificationMenu r={r} ref={mobileNotificationMenuRef} compact={true} />
          <HeaderProfileMenu r={r} ref={mobileProfileMenuRef} compact={true} />
        </div>
      </header>
      {props.appBar && <div className="careos-subbar">{props.appBar}</div>}
      {residentOpen && context && (
        <ResidentPickerPopover
          context={context}
          selectedAreaId={selectedAreaId}
          selectedResident={selectedResident}
          onClose={() => setResidentOpen(false)}
          onChoose={chooseResident}
        />
      )}{" "}
      {profilePopoverOpen && (
        <ProfilePopover
          context={context}
          onClose={() => setProfilePopoverOpen(false)}
          onSave={(data) => {
            setContext(data);
            setSelectedAreaId(data.profile.primaryCareUnitId);
            onToast("Profil und fester Wohnbereich gespeichert");
          }}
        />
      )}
    </>
  );
}

"use client";

import { ModuleIcon } from "./module-icon";
import { Brand } from "./header-parts";
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
      <header className="topbar">
        <div className="header-context">
          <HeaderLocationControl r={r} ref={locationMenuRef} />
          <HeaderResidentSelector r={r} />
        </div>
        <div className="top-actions">
          <button
            className="search-trigger"
            type="button"
            onClick={() => {
              closeMenus();
              onSearch();
            }}
            aria-label="Globale Suche öffnen"
            aria-expanded={searchOpen}
          >
            <ModuleIcon name="search" />
            <span>Suchen…</span>
            <kbd>⌘ K</kbd>
          </button>
          <HeaderAiButton />
          <KeyboardShortcutsMenu />
          <HeaderNotificationMenu r={r} ref={notificationMenuRef} />
          <HeaderProfileMenu r={r} ref={profileMenuRef} />
        </div>
      </header>
      <header className="mobile-top">
        <Brand />
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

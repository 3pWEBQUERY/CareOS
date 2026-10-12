"use client";

import AdminUserManagement from "./admin-user-management";
import { ConfigurationView } from "./configuration-view";
import { Props } from "./leadership-variant-parts";
import { OrganizationView } from "./organization-view";

export function AdminVariant({
  view,
  showToast,
  employeeCreatorOpen,
  onCloseEmployeeCreator,
  organization,
  siteCreatorOpen,
  onCloseSiteCreator,
  configuration,
  settingKey,
  onSelectSetting,
  settingEditorOpen,
  onCloseSettingEditor,
}: Props) {
  if (view === "users")
    return (
      <AdminUserManagement
        showToast={showToast}
        createOpen={Boolean(employeeCreatorOpen)}
        onCloseCreate={onCloseEmployeeCreator}
      />
    );
  if (view === "configuration")
    return (
      <ConfigurationView
        configuration={configuration}
        showToast={showToast}
        selectedKey={settingKey}
        onSelect={onSelectSetting}
        editorOpen={settingEditorOpen}
        onCloseEditor={onCloseSettingEditor}
      />
    );
  return (
    <OrganizationView
      organization={organization}
      showToast={showToast}
      siteCreatorOpen={siteCreatorOpen}
      onCloseSiteCreator={onCloseSiteCreator}
    />
  );
}

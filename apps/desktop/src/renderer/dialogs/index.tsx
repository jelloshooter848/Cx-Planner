import { useUi } from '../store';
import { AboutDialog } from './AboutDialog';
import { DataDateDialog } from './DataDateDialog';
import { AddAssetsDialog } from './AddAssets/AddAssetsDialog';
import { DeleteTaskDialog } from './DeleteTaskDialog';
import { NewProjectDialog } from './NewProjectDialog';
import { PrintDialog } from './Print/PrintDialog';
import { ProjectSettingsDialog } from './ProjectSettings/ProjectSettingsDialog';

/** The open dialog, if any (UiState.dialog). */
export function Dialogs() {
  const dialog = useUi().dialog;
  if (dialog === 'new-project') return <NewProjectDialog />;
  if (dialog === 'about') return <AboutDialog />;
  if (dialog === 'add-assets') return <AddAssetsDialog />;
  if (dialog === 'delete-task') return <DeleteTaskDialog />;
  if (dialog === 'print') return <PrintDialog />;
  if (dialog === 'project-settings') return <ProjectSettingsDialog />;
  if (dialog === 'data-date') return <DataDateDialog />;
  return null;
}

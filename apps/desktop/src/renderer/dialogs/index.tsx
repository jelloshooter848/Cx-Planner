import { useUi } from '../store';
import { AboutDialog } from './AboutDialog';
import { AddAssetsDialog } from './AddAssets/AddAssetsDialog';
import { NewProjectDialog } from './NewProjectDialog';
import { PrintDialog } from './Print/PrintDialog';

/** The open dialog, if any (UiState.dialog). */
export function Dialogs() {
  const dialog = useUi().dialog;
  if (dialog === 'new-project') return <NewProjectDialog />;
  if (dialog === 'about') return <AboutDialog />;
  if (dialog === 'add-assets') return <AddAssetsDialog />;
  if (dialog === 'print') return <PrintDialog />;
  return null;
}

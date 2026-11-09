import { useUi } from '../store';
import { AboutDialog } from './AboutDialog';
import { NewProjectDialog } from './NewProjectDialog';

/** The open dialog, if any (UiState.dialog). */
export function Dialogs() {
  const dialog = useUi().dialog;
  if (dialog === 'new-project') return <NewProjectDialog />;
  if (dialog === 'about') return <AboutDialog />;
  return null;
}

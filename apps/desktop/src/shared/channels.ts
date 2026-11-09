/** IPC channel names, shared by preload (sender) and main (handler). */
export const CH = {
  getState: 'state:get',
  /** main -> renderer: AppState after every change. */
  state: 'state:changed',
  /** main -> renderer: a MenuCommand. */
  menu: 'menu:command',
  apply: 'edit:apply',
  undo: 'edit:undo',
  redo: 'edit:redo',
  newProject: 'file:new',
  openProject: 'file:open',
  openRecent: 'file:open-recent',
  saveAs: 'file:save-as',
  closeProject: 'file:close',
  chooseWorkspace: 'workspace:choose',
  templateList: 'template:list',
  templateGet: 'template:get',
  templateSave: 'template:save',
  templateDuplicate: 'template:duplicate',
  templateDelete: 'template:delete',
  templateExport: 'template:export',
  templateImport: 'template:import',
  templateRestoreStarters: 'template:restore-starters',
  lookAheadHtml: 'print:lookahead-html',
  lookAheadPdf: 'print:lookahead-pdf',
} as const;

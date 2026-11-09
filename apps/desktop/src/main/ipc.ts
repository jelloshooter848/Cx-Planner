/** IPC handlers: the main-process side of shared/api.ts. Every input is checked in validate.ts. */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { basename, dirname, join } from 'node:path';
import type { ApiResult } from '../shared/api.js';
import { CH } from '../shared/channels.js';
import { PROJECT_EXT, safeFileName, type Dialogs, type FileController } from './files.js';
import { htmlToPdf, lookAheadDocument } from './print.js';
import { failure, ok, type Session } from './session.js';
import { checkCommand, checkId, checkName, checkNewProject, checkPaper, checkPath, checkTemplate } from './validate.js';

export interface IpcContext {
  session: Session;
  files: FileController;
  dialogs: Dialogs;
}

/** Only our own bundled page may call in (not, say, a page an iframe navigated to). */
function trusted(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  try {
    const u = new URL(url);
    return u.protocol === 'file:' && u.pathname.endsWith('/renderer/index.html') && e.senderFrame === e.sender.mainFrame;
  } catch {
    return false;
  }
}

export function registerIpc(ctx: IpcContext): void {
  const { session, files } = ctx;
  const handle = (channel: string, fn: (...args: unknown[]) => ApiResult<unknown> | Promise<ApiResult<unknown>>) =>
    ipcMain.handle(channel, async (e, ...args: unknown[]) => {
      if (!trusted(e)) return { ok: false, code: 'invalid-input', message: 'Refused: unknown caller' };
      try {
        return await fn(...args);
      } catch (err) {
        return failure(err);
      }
    });

  ipcMain.handle(CH.getState, (e) => {
    if (!trusted(e)) throw new Error('Refused: unknown caller');
    return session.getState();
  });

  handle(CH.apply, (cmd) => session.apply(checkCommand(cmd)));
  handle(CH.undo, () => session.undo());
  handle(CH.redo, () => session.redo());

  handle(CH.newProject, (input) => files.newProject(checkNewProject(input)));
  handle(CH.openProject, () => files.openWithDialog());
  handle(CH.openRecent, (path) => files.openRecent(checkPath(path)));
  handle(CH.saveAs, () => files.saveAs());
  handle(CH.closeProject, () => files.close());
  handle(CH.chooseWorkspace, () => files.chooseWorkspace());

  handle(CH.templateList, () => session.listTemplates());
  handle(CH.templateGet, (id) => session.getTemplate(checkId(id, 'template id')));
  handle(CH.templateSave, (t) => session.saveTemplate(checkTemplate(t)));
  handle(CH.templateDuplicate, (id, name) => session.duplicateTemplate(checkId(id, 'template id'), checkName(name, 'template name')));
  handle(CH.templateDelete, (id) => session.deleteTemplate(checkId(id, 'template id')));
  handle(CH.templateExport, (id) => files.exportTemplate(checkId(id, 'template id')));
  handle(CH.templateImport, () => files.importTemplate());
  handle(CH.templateRestoreStarters, () => session.restoreStarters());

  handle(CH.lookAheadHtml, (paper) => {
    const project = session.project;
    if (!project) return { ok: false, code: 'no-project', message: 'No project is open' };
    const { html, layout } = lookAheadDocument(project, { paper: checkPaper(paper), weeks: 3 });
    return ok({ html, sheets: layout.sheets.length, widthIn: layout.paper.widthIn, heightIn: layout.paper.heightIn });
  });

  handle(CH.lookAheadPdf, async (paper) => {
    const project = session.project;
    const filePath = session.filePath;
    if (!project || !filePath) return { ok: false, code: 'no-project', message: 'No project is open' };
    const { html, title } = lookAheadDocument(project, { paper: checkPaper(paper), weeks: 3 });
    const stem = basename(filePath, PROJECT_EXT);
    return files.writeWithDialog({
      title: 'Save look-ahead PDF',
      defaultPath: join(dirname(filePath), `${safeFileName(`${stem} ${title}`)}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      ext: '.pdf',
      data: () => htmlToPdf(html),
    });
  });
}

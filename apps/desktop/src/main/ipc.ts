/** IPC handlers: the main-process side of shared/api.ts. Every input is checked in validate.ts. */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { ApiResult } from '../shared/api.js';
import { CH } from '../shared/channels.js';
import type { Dialogs, FileController } from './files.js';
import type { PrintController } from './print-controller.js';
import { failure, ok, type Session } from './session.js';
import { checkCommand, checkId, checkName, checkNewProject, checkPath, checkPrintRequest, checkTemplate, checkUnsavedWork } from './validate.js';

export interface IpcContext {
  session: Session;
  files: FileController;
  dialogs: Dialogs;
  print: PrintController;
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
  const { session, files, print } = ctx;
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
  handle(CH.setUnsavedWork, (what) => {
    session.unsavedWork = checkUnsavedWork(what);
    return ok(undefined);
  });

  handle(CH.templateList, () => session.listTemplates());
  handle(CH.templateGet, (id) => session.getTemplate(checkId(id, 'template id')));
  handle(CH.templateInProject, (id) => session.getProjectTemplate(checkId(id, 'template id')));
  handle(CH.templateSave, (t) => session.saveTemplate(checkTemplate(t)));
  handle(CH.templateDuplicate, (id, name) => session.duplicateTemplate(checkId(id, 'template id'), checkName(name, 'template name')));
  handle(CH.templateDelete, (id) => session.deleteTemplate(checkId(id, 'template id')));
  handle(CH.templateExport, (id) => files.exportTemplate(checkId(id, 'template id')));
  handle(CH.templateImport, () => files.importTemplate());
  handle(CH.templateRestoreStarters, () => session.restoreStarters());

  handle(CH.printSetup, () => print.setup());
  handle(CH.printPreview, (req) => print.preview(checkPrintRequest(req)));
  handle(CH.printPdf, (req) => print.exportPdf(checkPrintRequest(req)));
  handle(CH.printToPrinter, (req) => print.toPrinter(checkPrintRequest(req)));
  handle(CH.printShowInFolder, (path) => print.showInFolder(checkPath(path)));
}

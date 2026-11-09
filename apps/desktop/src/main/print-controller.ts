/**
 * The main-process side of the Print dialog: preview, export to PDF, send to a printer. An
 * issued print (PDF written or sent to the printer) is recorded in the project's print
 * records, which gives the next print of that kind the next revision letter. Electron is
 * passed in (toPdf, toPrinter, showInFolder), so this can be unit-tested.
 */
import { basename, dirname, join } from 'node:path';
import type { Paper } from '@cx/render';
import type { ApiResult, PdfExported, PrintIssued, PrintPreview, PrintRequest, PrintSetup } from '../shared/api.js';
import { PROJECT_EXT, safeFileName, type FileController } from './files.js';
import { buildPrint, printSetup, type BuiltPrint } from './print-jobs.js';
import { failure, ok, type Session } from './session.js';

export interface PrintControllerOptions {
  session: Session;
  files: Pick<FileController, 'writeWithDialog'>;
  /** HTML print document -> PDF bytes. */
  toPdf(html: string): Promise<Uint8Array>;
  /** Shows the system print dialog; false when the user cancelled. */
  toPrinter(html: string, paper: Paper): Promise<boolean>;
  showInFolder(path: string): void;
  /** @font-face rules embedded in print documents. */
  fontCss?(): string | undefined;
}

const noProject = { ok: false, code: 'no-project', message: 'No project is open' } as const;

export class PrintController {
  /** PDFs written this session; only these may be shown in the file manager. */
  private readonly written = new Set<string>();

  constructor(private readonly opts: PrintControllerOptions) {}

  setup(): ApiResult<PrintSetup> {
    const { session } = this.opts;
    if (!session.project) return noProject;
    return ok(printSetup(session.project, session.templateSnapshots(), session.printHistory()));
  }

  preview(req: PrintRequest): ApiResult<PrintPreview> {
    const built = this.build(req);
    if (!built.ok) return built;
    const p = built.value;
    return ok({ html: p.html, sheets: p.sheets, widthIn: p.paper.widthIn, heightIn: p.paper.heightIn, title: p.title, rev: p.rev, issued: p.issued });
  }

  /**
   * Writes the PDF and records it. When the PDF was written but recording fails, the export
   * still succeeds (the file is on disk) and `notRecorded` says why.
   */
  async exportPdf(req: PrintRequest): Promise<ApiResult<PdfExported>> {
    const built = this.build(req);
    if (!built.ok) return built;
    const p = built.value;
    const projectFile = this.opts.session.filePath!;
    const stem = basename(projectFile, PROJECT_EXT);
    const saved = await this.opts.files.writeWithDialog({
      title: 'Export PDF',
      defaultPath: join(dirname(projectFile), `${safeFileName(`${stem} ${p.title} Rev ${p.rev}`)}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      ext: '.pdf',
      data: () => this.opts.toPdf(p.html),
    });
    if (!saved.ok) return saved;
    this.written.add(saved.value.filePath);
    const filePath = saved.value.filePath;
    const recorded = this.record(p, projectFile);
    if (!recorded.ok) return ok({ rev: p.rev, sheets: p.sheets, title: p.title, filePath, notRecorded: recorded.message });
    return ok({ ...recorded.value, filePath });
  }

  async toPrinter(req: PrintRequest): Promise<ApiResult<PrintIssued>> {
    const built = this.build(req);
    if (!built.ok) return built;
    const projectFile = this.opts.session.filePath!;
    if (!(await this.opts.toPrinter(built.value.html, built.value.paper))) return { ok: false, code: 'canceled', message: 'Printing was cancelled' };
    return this.record(built.value, projectFile);
  }

  showInFolder(path: string): ApiResult {
    if (!this.written.has(path)) return { ok: false, code: 'invalid-input', message: 'Only an exported PDF can be shown' };
    this.opts.showInFolder(path);
    return ok(undefined);
  }

  private build(req: PrintRequest): ApiResult<BuiltPrint> {
    const { session } = this.opts;
    const project = session.project;
    if (!project || !session.filePath) return noProject;
    try {
      return ok(buildPrint({ project, templates: session.templateSnapshots(), history: session.printHistory(), request: req, fontCss: this.opts.fontCss?.() }));
    } catch (e) {
      return failure(e);
    }
  }

  /** Records an issued print, if the project it came from is still the open one. */
  private record(p: BuiltPrint, projectFile: string): ApiResult<PrintIssued> {
    const { session } = this.opts;
    if (session.filePath !== projectFile) return { ok: false, code: 'no-project', message: 'The project was closed before the print was recorded' };
    try {
      session.recordPrint({ kind: p.kind, rev: p.rev, issued: p.issued, paper: p.paperId, sheets: p.sheets, dataDate: p.issued, note: p.note, title: p.title, ...(p.taskIds ? { taskIds: p.taskIds } : {}) });
    } catch (e) {
      return failure(e, 'file-error');
    }
    return ok({ rev: p.rev, sheets: p.sheets, title: p.title });
  }
}


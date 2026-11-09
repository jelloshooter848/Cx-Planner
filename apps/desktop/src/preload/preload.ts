import { contextBridge, ipcRenderer } from 'electron';

/** The only surface the renderer can reach. Keep it small and typed. */
const api = {
  lookAheadHtml: (paper: string): Promise<{ html: string; sheets: number; widthIn: number; heightIn: number }> =>
    ipcRenderer.invoke('print:lookahead-html', paper),
  lookAheadPdf: (paper: string): Promise<{ saved: boolean; path?: string }> => ipcRenderer.invoke('print:lookahead-pdf', paper),
};

export type CxApi = typeof api;
contextBridge.exposeInMainWorld('cx', api);

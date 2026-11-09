import type { PrintLayout } from './gantt-print.js';

/**
 * Wrap laid-out sheets in a print-ready HTML document: one sheet per physical page,
 * page size set with CSS so Chromium's printToPDF / page.pdf honour it exactly.
 */
export function printDocumentHtml(layout: PrintLayout, opts: { title: string; fontCss?: string }): string {
  const { widthIn, heightIn } = layout.paper;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${opts.title.replace(/</g, '&lt;')}</title>
<style>
${opts.fontCss ?? ''}
@page { size: ${widthIn}in ${heightIn}in; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.sheet { width: ${widthIn}in; height: ${heightIn}in; overflow: hidden; break-after: page; }
.sheet:last-child { break-after: auto; }
.sheet svg { display: block; }
</style></head>
<body>
${layout.sheets.map((s) => `<div class="sheet" data-sheet="${s.number}">${s.svg}</div>`).join('\n')}
</body></html>`;
}

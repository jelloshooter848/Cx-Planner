import type { Dialogs, MessageOptions } from './files.js';

export type ScriptedAnswer =
  | { open: string | undefined }
  | { save: string | undefined }
  /** Button index to press; `expect` (a regex source) must match the message. */
  | { message: number; expect?: string };

/**
 * Dialogs that answer from a script, for tests and the headless session spike. Each call
 * takes the next answer, which must be of the same kind. `shown` records every dialog.
 */
export class ScriptedDialogs implements Dialogs {
  readonly shown: Array<{ kind: 'open' | 'save' | 'message'; title: string; detail?: string; defaultPath?: string }> = [];
  constructor(private readonly script: ScriptedAnswer[] = []) {}

  push(...answers: ScriptedAnswer[]): this {
    this.script.push(...answers);
    return this;
  }

  get remaining(): number {
    return this.script.length;
  }

  private next(kind: 'open' | 'save' | 'message', title: string): ScriptedAnswer {
    const a = this.script.shift();
    if (!a || !(kind in a)) throw new Error(`Unexpected ${kind} dialog "${title}" (next scripted answer: ${JSON.stringify(a)})`);
    return a;
  }

  async open(o: { title: string; defaultPath?: string }): Promise<string | undefined> {
    this.shown.push({ kind: 'open', title: o.title, defaultPath: o.defaultPath });
    return (this.next('open', o.title) as { open: string | undefined }).open;
  }

  async save(o: { title: string; defaultPath: string }): Promise<string | undefined> {
    this.shown.push({ kind: 'save', title: o.title, defaultPath: o.defaultPath });
    return (this.next('save', o.title) as { save: string | undefined }).save;
  }

  async message(o: MessageOptions): Promise<number> {
    this.shown.push({ kind: 'message', title: o.message, detail: o.detail });
    const a = this.next('message', o.message) as { message: number; expect?: string };
    if (a.expect && !new RegExp(a.expect).test(`${o.message}\n${o.detail ?? ''}`)) {
      throw new Error(`Dialog "${o.message}" does not match /${a.expect}/`);
    }
    return a.message;
  }
}

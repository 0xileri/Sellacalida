// Terminal prompts for the scripts that broadcast: a y/N confirmation and a hidden secret input.
import { createInterface } from 'node:readline';

// One reader for the whole run, with a queue: piped answers that arrive before a prompt are kept,
// and once stdin ends every further prompt is a "no" (never a hang, never a silent exit).
const answers: string[] = [];
let waiting: ((line: string | null) => void) | null = null;
let inputEnded = false;
let reader: ReturnType<typeof createInterface> | null = null;

function startReader() {
  if (reader) return;
  reader = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  reader.on('line', (line) => {
    if (waiting) {
      const w = waiting;
      waiting = null;
      w(line);
    } else answers.push(line);
  });
  reader.on('close', () => {
    inputEnded = true;
    if (waiting) {
      const w = waiting;
      waiting = null;
      w(null);
    }
  });
}

/** y / yes broadcasts; anything else, or no input left, is a no. */
export function ask(question: string): Promise<boolean> {
  startReader();
  // the reader's own prompt, so a redraw while typing (backspace) keeps the question on screen
  reader!.setPrompt(question);
  reader!.prompt(true);
  return new Promise((resolve) => {
    const done = (line: string | null) => {
      if (line === null) process.stdout.write('(no input: treated as no)\n');
      else if (!process.stdin.isTTY) process.stdout.write(`${line}\n`);
      resolve(line !== null && /^y(es)?$/i.test(line.trim()));
    };
    if (answers.length) done(answers.shift()!);
    else if (inputEnded) done(null);
    else waiting = done;
  });
}

/**
 * Ask for a secret (a WIF) without echoing it. Call it before the first ask(): it opens and closes
 * its own reader. The answer is never written anywhere.
 */
export function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    const write = out._writeToOutput.bind(rl);
    let muted = false;
    out._writeToOutput = (s: string) => {
      if (!muted) write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = true;
  });
}

// 16-color ANSI styles for terminal output
// Compatible with all terminals (no RGB/256 colors)

const ESC = "\x1b[";

export const c = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  green: `${ESC}32m`,
  red: `${ESC}31m`,
  yellow: `${ESC}33m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
};

export function green(s: string) { return `${c.green}${s}${c.reset}`; }
export function red(s: string) { return `${c.red}${s}${c.reset}`; }
export function yellow(s: string) { return `${c.yellow}${s}${c.reset}`; }
export function cyan(s: string) { return `${c.cyan}${s}${c.reset}`; }
export function dim(s: string) { return `${c.dim}${s}${c.reset}`; }
export function bold(s: string) { return `${c.bold}${s}${c.reset}`; }

export const icon = {
  success: green("✓"),
  error: red("✕"),
  live: green("●"),
  building: yellow("○"),
  pending: dim("○"),
  arrow: dim("→"),
  dot: dim("·"),
};

/**
 * Format elapsed time nicely
 */
export function elapsed(startMs: number): string {
  const ms = Date.now() - startMs;
  if (ms < 1000) return dim(`(${ms}ms)`);
  const s = (ms / 1000).toFixed(1);
  return dim(`(${s}s)`);
}

/**
 * Spinner that updates in place
 */
export class Spinner {
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private i = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  start() {
    this.interval = setInterval(() => {
      const frame = this.frames[this.i % this.frames.length];
      process.stdout.write(`\r  ${cyan(frame)} ${this.text}`);
      this.i++;
    }, 80);
  }

  update(text: string) {
    this.text = text;
  }

  stop(finalText?: string) {
    if (this.interval) clearInterval(this.interval);
    process.stdout.write("\r\x1b[K"); // clear line
    if (finalText) console.log(finalText);
  }
}

/**
 * Print a boxed header
 */
export function header(title: string) {
  console.log();
  console.log(`  ${bold(title)}`);
  console.log();
}

/**
 * Print key-value pair
 */
export function kv(key: string, value: string) {
  console.log(`  ${dim(key.padEnd(12))} ${value}`);
}

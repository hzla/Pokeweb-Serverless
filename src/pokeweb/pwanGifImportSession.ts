import { compileGifToPwanAsync } from "./pwanCompilerClient";
import type { PwanColorPreset, PwanCompileOptions, PwanCompileResult } from "./pwanCompiler";

export type PwanGifImportSource = { fileName: string; bytes: Uint8Array };
type Compiler = (bytes: Uint8Array, options: PwanCompileOptions) => Promise<PwanCompileResult>;

/** A preview is not a project mutation. Only the latest completed conversion can be applied. */
export class PwanGifImportSession {
  source?: PwanGifImportSource;
  result?: PwanCompileResult;
  error?: string;
  busy = false;
  colorPreset: PwanColorPreset;
  private revision = 0;

  constructor(private readonly options: {
    colorPreset?: PwanColorPreset;
    source?: PwanGifImportSource;
    result?: PwanCompileResult;
    compile?: Compiler;
    onChange?: () => void;
  } = {}) {
    this.colorPreset = options.colorPreset ?? "none";
    this.source = options.source;
    this.result = options.result;
  }

  ready(): { source: PwanGifImportSource; result: PwanCompileResult } | undefined {
    return !this.busy && !this.error && this.source && this.result ? { source: this.source, result: this.result } : undefined;
  }

  async setFile(file: Pick<File, "name" | "arrayBuffer">): Promise<void> {
    const revision = ++this.revision;
    this.source = undefined;
    this.invalidate(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (revision !== this.revision) return;
      this.source = { fileName: file.name, bytes };
      await this.compile(revision);
    } catch (error) {
      this.fail(revision, error);
    }
  }

  async setSource(source?: PwanGifImportSource): Promise<void> {
    const revision = ++this.revision;
    this.source = source ? { ...source, bytes: source.bytes.slice() } : undefined;
    this.invalidate(Boolean(source));
    if (source) await this.compile(revision);
  }

  async setPreset(preset: PwanColorPreset): Promise<void> {
    this.colorPreset = preset;
    // A file may still be being read; its conversion will use the latest preset.
    if (!this.source) { this.options.onChange?.(); return; }
    const revision = ++this.revision;
    this.invalidate(true);
    await this.compile(revision);
  }

  private invalidate(busy: boolean): void {
    this.result = undefined;
    this.error = undefined;
    this.busy = busy;
    this.options.onChange?.();
  }

  private async compile(revision: number): Promise<void> {
    if (!this.source) return;
    try {
      const result = await (this.options.compile ?? compileGifToPwanAsync)(this.source.bytes, { colorPreset: this.colorPreset, includePreview: true });
      if (revision !== this.revision) return;
      this.result = result;
      this.busy = false;
      this.options.onChange?.();
    } catch (error) {
      this.fail(revision, error);
    }
  }

  private fail(revision: number, error: unknown): void {
    if (revision !== this.revision) return;
    this.result = undefined;
    this.error = error instanceof Error ? error.message : String(error);
    this.busy = false;
    this.options.onChange?.();
  }
}

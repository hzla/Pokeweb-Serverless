import { parseMoveAnimationScript, type ParsedMoveAnimationCommand } from "./moveAnimationModel";

export type MoveAnimationShakeOverlap = {
  label: string;
  earlierCommand: number;
  laterCommand: number;
  selector: number;
  earlierKind: string;
  laterKind: string;
  availableTicks: number;
  requiredTicks: number;
  crossesWait: boolean;
};
export type MoveAnimationShakeRepair = MoveAnimationShakeOverlap & {
  command: number;
  action: "shorten" | "omit";
  previousCycles: number;
  cycles: number;
};

type Motion = {
  command: ParsedMoveAnimationCommand;
  index: number;
  start: number;
  duration: number;
  barrier: number;
};

/** Native position tweens update every display tick. A roundtrip has two
 * frame-sized legs (four for mode 3), with wait ticks between position steps.
 * The last step has no trailing wait. Modes 0/6 set a position immediately.
 */
export function getMoveAnimationShakeTicks(params: readonly number[]): number {
  const [, mode, , , frames, wait, cycles] = params;
  if (mode === 0 || mode === 6) return 0;
  if (![1, 2, 3, 4, 5].includes(mode) || frames <= 0 || wait < 0) return Infinity;
  const steps = frames * (mode === 2 ? 2 * cycles : mode === 3 ? 4 * cycles : 1);
  return steps > 0 ? steps * (wait + 1) - wait : Infinity;
}

function circleTicks(params: readonly number[]): number {
  const frames = params[5] >> 12, wait = params[6] >> 12, cycles = params[7] >> 12;
  if (cycles === 0) return 0;
  if (frames <= 0 || wait < 0 || cycles < 0 || frames > 65536) return Infinity;
  // The native circle advances a 16-bit phase by integer 65536 / frames.
  const steps = Math.ceil(65536 / Math.floor(65536 / frames));
  return steps * cycles * (wait + 1) - wait + Math.max(0, cycles - 1) * params[8];
}

/** Inspect every header body independently. Timing is a conservative lower
 * bound: ordinary commands yield one tick outside AudioContainer CONTINUE;
 * Wait n yields n+1. Camera/particle waits can add further time. Pokémon/ALL
 * completion waits drain position tasks. This is scoped to packaged scripts,
 * not an interpreter for arbitrary branching animation programs.
 */
export function auditMoveAnimationShakes(script: string): MoveAnimationShakeOverlap[] {
  return inspect(script, false).overlaps;
}

export function repairMoveAnimationShakes(script: string): { script: string; repairs: MoveAnimationShakeRepair[] } {
  const result = inspect(script, true);
  if (!result.repairs.length) return { script, repairs: [] };
  const parsed = parseMoveAnimationScript(script);
  let label = parsed.labelOrder[0], index = 0;
  const rewritten = script.split("\n").map(line => {
    const clean = line.replace(/@.*$/u, "").trim();
    const match = /^([A-Za-z_][A-Za-z0-9_]*):$/u.exec(clean);
    if (match) { label = match[1]; index = 0; return line; }
    const command = parsed.scripts.get(label)?.[index];
    if (!command || clean !== command.line.trim()) return line;
    const replacement = result.replacements.get(`${label}:${index}`);
    index += 1;
    return replacement ?? line;
  }).join("\n");
  if (auditMoveAnimationShakes(rewritten).length) throw new Error("A bundled sprite shake still overlaps another position task.");
  return { script: rewritten, repairs: result.repairs };
}

function inspect(script: string, repair: boolean) {
  const parsed = parseMoveAnimationScript(script);
  const overlaps: MoveAnimationShakeOverlap[] = [], repairs: MoveAnimationShakeRepair[] = [];
  const replacements = new Map<string, string>();
  for (const [label, commands] of parsed.scripts) {
    let tick = 0, yieldTick = 1, barrier = 0;
    const active = new Map<number, Motion>();
    for (const [index, command] of commands.entries()) {
      const params = command.params;
      if (command.name === "AudioContainer") { yieldTick = params[0] === 0 ? 0 : 1; continue; }
      if (command.name === "LetCMDsFinish") {
        if (params[0] === 0 || params[0] === 3) active.clear();
        barrier += 1; tick += 2; continue;
      }
      const duration = command.name === "ShakeSprite" ? getMoveAnimationShakeTicks(params)
        : command.name === "MoveSprite" ? circleTicks(params) : 0;
      if (duration > 0) {
        const previous = active.get(params[0]);
        let omitCurrent = false;
        if (previous && previous.start + previous.duration > tick) {
          const overlap: MoveAnimationShakeOverlap = {
            label, earlierCommand: previous.index, laterCommand: index, selector: params[0],
            earlierKind: previous.command.name, laterKind: command.name,
            availableTicks: tick - previous.start, requiredTicks: previous.duration,
            crossesWait: previous.barrier !== barrier,
          };
          // Circle/circle conflicts are distinct from the shake cancellation
          // issue; do not silently rewrite a primary movement path.
          if (previous.command.name === "ShakeSprite" || command.name === "ShakeSprite") {
            overlaps.push(overlap);
            if (repair) {
              const edit = previous.command.name === "ShakeSprite" ? previous : { command, index, start: tick, duration, barrier };
              const p = edit.command.params.slice();
              if (![2, 3].includes(p[1]) || yieldTick !== 1) throw new Error("A bundled position conflict needs a reviewed shake repair.");
              const cycles = edit === previous
                ? Math.max(0, Math.min(p[6], Math.floor((overlap.availableTicks + p[5]) / ((p[1] === 3 ? 4 : 2) * p[4] * (p[5] + 1)))))
                : 0;
              repairs.push({ ...overlap, command: edit.index, action: cycles ? "shorten" : "omit", previousCycles: p[6], cycles });
              p[6] = cycles;
              // Wait 0 consumes the omitted command's single VM tick, keeping
              // explicit waits and following command scheduling in place.
              replacements.set(`${label}:${edit.index}`, cycles ? `ShakeSprite ${p.join(", ")}` : "Wait 0");
              omitCurrent = edit.index === index;
            }
          }
        }
        if (!omitCurrent) active.set(params[0], { command, index, start: tick, duration, barrier });
      }
      tick += command.name === "Wait" ? Math.max(0, params[0]) + 1 : yieldTick;
    }
  }
  return { overlaps, repairs, replacements };
}

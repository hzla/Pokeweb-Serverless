import { parseMoveAnimationScript, type ParsedMoveAnimationCommand } from "./moveAnimationModel";

export type MoveAnimationPhaseName = "setup" | "gather" | "projectile" | "impact" | "healing" | "background" | "cleanup";

export type MoveAnimationCommandPoint = {
  index: number;
  frame: number;
  command: string;
  params: number[];
  line: string;
};

export type MoveAnimationSegmentRange = {
  name: MoveAnimationPhaseName;
  label: string;
  startCommand: number;
  endCommand: number;
  startFrame: number;
  endFrame: number;
  commands: string[];
};

export type MoveAnimationSegmentAnalysis = {
  labels: string[];
  commands: Record<string, MoveAnimationCommandPoint[]>;
  inferred: MoveAnimationSegmentRange[];
};

export type MoveAnimationSegmentSelection = {
  label?: string;
  phase?: MoveAnimationPhaseName;
  from?: number;
  to?: number;
};

export type ExtractedMoveAnimationSegment = {
  name: string;
  sourceLabel: string;
  sourceRange: [number, number];
  script: string;
  dependencies: {
    spas: number[];
    backgrounds: number[];
    sounds: number[];
  };
  taskOverlap: Array<{ frame: number; commands: string[] }>;
  omittedSetup: string[];
  omittedCleanup: string[];
};

export function analyzeMoveAnimationSegments(scriptText: string): MoveAnimationSegmentAnalysis {
  const parsed = parseMoveAnimationScript(scriptText);
  const commands: Record<string, MoveAnimationCommandPoint[]> = {};
  const inferred: MoveAnimationSegmentRange[] = [];
  for (const label of parsed.labelOrder) {
    const points = commandPoints(parsed.scripts.get(label) ?? []);
    commands[label] = points;
    inferred.push(...inferRanges(label, points));
  }
  return { labels: parsed.labelOrder.slice(), commands, inferred };
}

export function extractMoveAnimationSegment(
  scriptText: string,
  name: string,
  selection: MoveAnimationSegmentSelection,
): ExtractedMoveAnimationSegment {
  const analysis = analyzeMoveAnimationSegments(scriptText);
  const label = selection.label ?? analysis.labels[0];
  if (!label) throw new Error("Animation script contains no labels.");
  const points = analysis.commands[label];
  if (!points) throw new Error(`Animation label ${label} does not exist.`);
  const inferred = selection.phase ? analysis.inferred.find((range) => range.label === label && range.name === selection.phase) : undefined;
  if (selection.phase && !inferred) throw new Error(`No inferred ${selection.phase} phase exists in ${label}. Use an explicit command range.`);
  const from = selection.from ?? inferred?.startCommand ?? 0;
  const to = selection.to ?? inferred?.endCommand ?? points.length - 1;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= points.length) {
    throw new Error(`Invalid command range ${from}-${to}; ${label} contains ${points.length} command(s).`);
  }

  let selected = points.slice(from, to + 1);
  while (selected[0] && (selected[0].command === "Wait" || selected[0].command === "LetCMDsFinish")) selected = selected.slice(1);
  const selectedSpaIds = idsForCommands(selected, SPA_REFERENCE_COMMANDS);
  const selectedBackgroundIds = idsForCommands(selected, new Set(["LoadBackground"]));
  const needsPriorBackground = selected.some((point) => BACKGROUND_REFERENCE_COMMANDS.has(point.command)) && selectedBackgroundIds.size === 0;
  const dependencies = dependencyLines(points.slice(0, from), selectedSpaIds, selectedBackgroundIds, needsPriorBackground);
  const body = [...dependencies.lines, ...selected.map((point) => point.line)].filter((line, index, lines) => {
    if (line !== "TerminateMoveScript" && !line.startsWith("CallMoveAnimation ")) return true;
    return index === lines.length - 1;
  });
  if (!body.some(isTerminatingLine)) body.push("TerminateMoveScript");

  const setupRange = analysis.inferred.find((range) => range.label === label && range.name === "setup");
  const cleanupRange = analysis.inferred.find((range) => range.label === label && range.name === "cleanup");
  const omittedSetup = setupRange && from > setupRange.startCommand
    ? points.slice(setupRange.startCommand, Math.min(from, setupRange.endCommand + 1)).map((point) => point.line).filter((line) => !dependencies.lines.includes(line))
    : [];
  const omittedCleanup = cleanupRange && to < cleanupRange.endCommand
    ? points.slice(Math.max(to + 1, cleanupRange.startCommand), cleanupRange.endCommand + 1).map((point) => point.line)
    : [];

  return {
    name,
    sourceLabel: label,
    sourceRange: [from, to],
    script: `${body.join("\n")}\n`,
    dependencies: {
      spas: dependencies.spas,
      backgrounds: dependencies.backgrounds,
      sounds: [...new Set(selected.filter((point) => point.command === "PlaySound").map((point) => point.params[0] ?? -1).filter((id) => id >= 0))],
    },
    taskOverlap: overlappingTasks(selected),
    omittedSetup,
    omittedCleanup,
  };
}

export function composeMoveAnimationSegments(segments: ExtractedMoveAnimationSegment[]): { script: string; report: string[] } {
  if (segments.length === 0) throw new Error("At least one move animation segment is required.");
  const loads = new Set<number>();
  const backgrounds = new Set<number>();
  const lines: string[] = [];
  const report: string[] = [];
  for (const segment of segments) {
    const parsed = parseMoveAnimationScript(segment.script);
    const commands = [...parsed.scripts.values()][0] ?? [];
    for (const command of commands) {
      if (command.name === "TerminateMoveScript" || command.name === "CallMoveAnimation") continue;
      if (command.name === "LoadSPA") {
        const id = command.params[0] ?? -1;
        if (loads.has(id)) continue;
        loads.add(id);
      }
      if (command.name === "LoadBackground") {
        const id = command.params[0] ?? -1;
        if (backgrounds.has(id)) continue;
        backgrounds.add(id);
      }
      lines.push(command.line);
    }
    report.push(`${segment.name}: ${segment.sourceLabel} commands ${segment.sourceRange[0]}-${segment.sourceRange[1]}; SPA ${segment.dependencies.spas.join(",") || "none"}; overlap ${segment.taskOverlap.length}`);
    if (segment.omittedSetup.length) report.push(`${segment.name}: omitted setup candidates: ${segment.omittedSetup.join(" | ")}`);
    if (segment.omittedCleanup.length) report.push(`${segment.name}: omitted cleanup candidates: ${segment.omittedCleanup.join(" | ")}`);
  }
  lines.push("TerminateMoveScript");
  return { script: `${lines.join("\n")}\n`, report };
}

const SPA_REFERENCE_COMMANDS = new Set([
  "LoadSPA", "DoSPAAnimation", "DoSPAScreenAnimation", "DoSPAAnimation2", "DoSPAAllAnimations", "DeleteSPA",
  "DoSPAProjectileAnimation", "DoSPAProjectileAnimation2", "DoSPAProjectileAnimation3", "DoSPAProjectileAnimationOrthoCoordinate",
  "DoSPACircleAnimation", "DoSPAOrthoCircleAnimation",
]);
const SPA_SPAWN_COMMANDS = new Set([...SPA_REFERENCE_COMMANDS].filter((command) => command !== "LoadSPA" && command !== "DeleteSPA"));
const PROJECTILE_COMMANDS = new Set([...SPA_SPAWN_COMMANDS].filter((command) => command.includes("Projectile")));
const BACKGROUND_REFERENCE_COMMANDS = new Set(["LoadBackground", "MoveBackground", "DistortBackground", "BackgroundPaletteAnimation", "BackgroundPriority", "BackgroundAlpha", "ChangeBackgroundColor", "ApplyBackground"]);
const CLEANUP_COMMANDS = new Set(["ApplyBackground", "CameraPosPush", "DeleteSPA", "DeleteObject", "DeleteTrainer", "TerminateMoveScript"]);
const HEALING_COMMANDS = new Set(["ChangeColor", "SpriteOpacity", "PokemonMosaic"]);

function commandPoints(commands: ParsedMoveAnimationCommand[]): MoveAnimationCommandPoint[] {
  let frame = 0;
  return commands.map((command, index) => {
    const point = { index, frame, command: command.name, params: command.params.slice(), line: command.line };
    if (command.name === "Wait") frame += Math.max(0, command.params[0] ?? 0);
    return point;
  });
}

function inferRanges(label: string, points: MoveAnimationCommandPoint[]): MoveAnimationSegmentRange[] {
  if (points.length === 0) return [];
  const firstVisual = points.findIndex((point) => SPA_SPAWN_COMMANDS.has(point.command));
  const firstProjectile = points.findIndex((point) => PROJECTILE_COMMANDS.has(point.command));
  const projectileEnd = firstProjectile < 0 ? -1 : findProjectileEnd(points, firstProjectile);
  const cleanupStart = findCleanupStart(points);
  const ranges: MoveAnimationSegmentRange[] = [];
  addRange(ranges, "setup", label, points, 0, Math.max(0, (firstVisual < 0 ? cleanupStart : firstVisual) - 1));
  if (firstVisual >= 0 && firstProjectile > firstVisual) addRange(ranges, "gather", label, points, firstVisual, firstProjectile - 1);
  if (firstProjectile >= 0) addRange(ranges, "projectile", label, points, firstProjectile, projectileEnd);
  const impactStart = firstProjectile >= 0 ? projectileEnd + 1 : firstVisual;
  if (impactStart >= 0 && impactStart < cleanupStart) addRange(ranges, "impact", label, points, impactStart, cleanupStart - 1);
  const healing = indicesMatching(points, (point) => HEALING_COMMANDS.has(point.command) && targetsDefender(point));
  if (healing.length) addRange(ranges, "healing", label, points, healing[0]!, healing.at(-1)!);
  const background = indicesMatching(points, (point) => BACKGROUND_REFERENCE_COMMANDS.has(point.command));
  if (background.length) addRange(ranges, "background", label, points, background[0]!, background.at(-1)!);
  addRange(ranges, "cleanup", label, points, cleanupStart, points.length - 1);
  return ranges.filter((range, index, all) => all.findIndex((other) => other.name === range.name && other.startCommand === range.startCommand && other.endCommand === range.endCommand) === index);
}

function addRange(out: MoveAnimationSegmentRange[], name: MoveAnimationPhaseName, label: string, points: MoveAnimationCommandPoint[], start: number, end: number): void {
  if (start < 0 || end < start || !points[start] || !points[end]) return;
  out.push({
    name,
    label,
    startCommand: start,
    endCommand: end,
    startFrame: points[start]!.frame,
    endFrame: points[end]!.frame,
    commands: [...new Set(points.slice(start, end + 1).map((point) => point.command))],
  });
}

function findProjectileEnd(points: MoveAnimationCommandPoint[], start: number): number {
  let end = start;
  for (let index = start + 1; index < points.length; index += 1) {
    const point = points[index]!;
    if (PROJECTILE_COMMANDS.has(point.command) || point.command === "Wait" || point.command === "PlaySound") end = index;
    else if (SPA_SPAWN_COMMANDS.has(point.command) || targetsDefender(point)) break;
  }
  return end;
}

function findCleanupStart(points: MoveAnimationCommandPoint[]): number {
  let start = Math.max(0, points.length - 1);
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index]!;
    if (CLEANUP_COMMANDS.has(point.command) || isRestoreCommand(point) || point.command === "LetCMDsFinish" || point.command === "Wait") start = index;
    else if (start < points.length - 1) break;
  }
  return start;
}

function isRestoreCommand(point: MoveAnimationCommandPoint): boolean {
  if (point.command === "MoveCamera") return (point.params[1] ?? -1) === 8;
  if (point.command === "FreezeSprite") return (point.params[1] ?? 0) === 1;
  if (point.command === "ChangeVisibility" || point.command === "PokemonShadowVanish") return (point.params[1] ?? 0) === 1 || (point.params[1] ?? 0) === 5;
  if (point.command === "DistortSprite") return (point.params[2] ?? 0) === 4096 && (point.params[3] ?? 0) === 4096;
  return false;
}

function targetsDefender(point: MoveAnimationCommandPoint): boolean {
  return point.params[0] === 16 || point.params[2] === 11 || point.params[3] === 11 || point.params[4] === 11 || point.params[6] === 11;
}

function idsForCommands(points: MoveAnimationCommandPoint[], commands: Set<string>): Set<number> {
  return new Set(points.filter((point) => commands.has(point.command)).map((point) => point.params[0] ?? -1).filter((id) => id >= 0));
}

function dependencyLines(prior: MoveAnimationCommandPoint[], spas: Set<number>, backgrounds: Set<number>, needsPriorBackground: boolean): { lines: string[]; spas: number[]; backgrounds: number[] } {
  const lines: string[] = [];
  const foundSpas: number[] = [];
  const foundBackgrounds: number[] = [];
  for (const id of spas) {
    const load = findLastPoint(prior, (point) => point.command === "LoadSPA" && point.params[0] === id);
    if (load) {
      lines.push(load.line);
      foundSpas.push(id);
    }
  }
  for (const id of backgrounds) {
    const load = findLastPoint(prior, (point) => point.command === "LoadBackground" && point.params[0] === id);
    if (load) {
      lines.push(load.line);
      foundBackgrounds.push(id);
    }
  }
  if (needsPriorBackground) {
    const load = findLastPoint(prior, (point) => point.command === "LoadBackground");
    const id = load?.params[0] ?? -1;
    if (load && id >= 0) {
      lines.push(load.line);
      foundBackgrounds.push(id);
    }
  }
  return { lines: [...new Set(lines)], spas: [...new Set([...spas, ...foundSpas])], backgrounds: [...new Set([...backgrounds, ...foundBackgrounds])] };
}

function findLastPoint(points: MoveAnimationCommandPoint[], predicate: (point: MoveAnimationCommandPoint) => boolean): MoveAnimationCommandPoint | undefined {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (predicate(points[index]!)) return points[index];
  }
  return undefined;
}

function overlappingTasks(points: MoveAnimationCommandPoint[]): Array<{ frame: number; commands: string[] }> {
  const grouped = new Map<number, string[]>();
  for (const point of points) {
    if (point.command === "Wait" || point.command === "LoadSPA" || point.command === "LoadBackground" || isTerminatingLine(point.line)) continue;
    const commands = grouped.get(point.frame) ?? [];
    commands.push(point.command);
    grouped.set(point.frame, commands);
  }
  return [...grouped.entries()].filter(([, commands]) => commands.length > 1).map(([frame, commands]) => ({ frame, commands }));
}

function indicesMatching(points: MoveAnimationCommandPoint[], predicate: (point: MoveAnimationCommandPoint) => boolean): number[] {
  return points.flatMap((point, index) => predicate(point) ? [index] : []);
}

function isTerminatingLine(line: string): boolean {
  return line === "TerminateMoveScript" || line.startsWith("CallMoveAnimation ");
}

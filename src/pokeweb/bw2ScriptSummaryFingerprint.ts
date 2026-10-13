import { sha256Hex } from "../nds/sha256";
import { bw2CommandByOpcode } from "./bw2ScriptCompiler/commands";
import type { CompiledBw2Script } from "./bw2ScriptCompiler";

export const BW2_ROUTINE_FINGERPRINT_VERSION = 1;
type Node = { kind: "code" | "movement" | "data"; offset: number; end: number; name: string; hash: string;
  edges: { kind: string; operand: number; target: Node; delta: number }[]; shape?: unknown[]; invalid?: boolean };

/** A rooted dependency graph, with relative pointers replaced by graph edges.
 * Names and absolute positions are deliberately absent. Literals, operand sizes,
 * internal target positions, shared targets, and every dependency's bytes remain
 * significant. Entry roles and referenced/detached status belong to the root. */
export function bw2RoutineFingerprints(compiled: CompiledBw2Script): ReadonlyMap<number, string> {
  const nodes: Node[] = [];
  const add = (kind: Node["kind"], block: { offset: number; endOffset?: number; name: string; bytes?: Uint8Array }) => {
    const end = block.endOffset ?? block.offset + block.bytes!.length;
    if (end > block.offset) nodes.push({ kind, offset: block.offset, end, name: block.name, hash: "", edges: [] });
  };
  for (const block of compiled.codeBlocks ?? []) add("code", block);
  for (const block of compiled.movementBlocks ?? []) add("movement", block);
  for (const block of compiled.dataBlocks ?? []) {
    if (!nodes.some((n) => n.kind === "movement" && n.offset === block.offset && n.end === block.offset + block.bytes.length)) add("data", block);
  }
  nodes.sort((a, b) => a.offset - b.offset);
  if (nodes.some((node, i) => i > 0 && nodes[i - 1].end > node.offset)) return new Map();
  const find = (offset: number): Node | undefined => {
    let low = 0, high = nodes.length - 1;
    while (low <= high) { const mid = (low + high) >>> 1, n = nodes[mid];
      if (offset < n.offset) high = mid - 1; else if (offset >= n.end) low = mid + 1; else return n;
    }
  };
  const instructions = new Map(compiled.instructions.map((i) => {
    const widths = bw2CommandByOpcode(i.opcode, i.dispatchId ?? compiled.overlayId)?.definition.widths;
    return [i.offset, { ...i, next: i.offset + 2 + (widths?.reduce((a, b) => a + b, 0) ?? 0) }] as const;
  }));
  const transfers = new Map<number, Map<string, number>>();
  const referenced = new Set<Node>();
  for (const node of nodes) {
    const normalized = Uint8Array.from(compiled.bytes.subarray(node.offset, node.end));
    for (const relocation of compiled.relocations) {
      if (relocation.kind === "entry" || relocation.operandOffset < node.offset || relocation.operandOffset + 4 > node.end) continue;
      const target = find(relocation.targetOffset);
      if (!target) { node.invalid = true; continue; }
      normalized.fill(0, relocation.operandOffset - node.offset, relocation.operandOffset - node.offset + 4);
      node.edges.push({ kind: relocation.kind, operand: relocation.operandOffset - node.offset, target, delta: relocation.targetOffset - target.offset });
      if (relocation.kind === "movement") referenced.add(target);
    }
    node.hash = sha256Hex(normalized);
    if (node.kind !== "code") continue;
    const own = [...instructions.values()].filter((i) => i.offset >= node.offset && i.next <= node.end);
    node.shape = own.map((i) => [i.offset - node.offset, i.opcode, i.next - i.offset, i.opcode >= 1000 ? i.dispatchId ?? compiled.overlayId ?? null : null]);
    for (const instruction of own) {
      const outgoing = new Map<string, number>();
      for (const edge of node.edges) if (node.offset + edge.operand >= instruction.offset && node.offset + edge.operand < instruction.next) outgoing.set(edge.kind, edge.target.offset + edge.delta);
      transfers.set(instruction.offset, outgoing);
    }
    const last = own.at(-1);
    if (last && last.next === node.end && ![2, 5, 0x1d, 0x1e].includes(last.opcode)) {
      const next = find(last.next);
      if (next) node.edges.push({ kind: "next", operand: node.end - node.offset, target: next, delta: last.next - next.offset });
      // A detached bounded fragment can end at an unowned alignment gap. Its
      // missing continuation is represented by its unchanged body boundary.
    }
    node.edges.sort((a, b) => a.operand - b.operand || a.kind.localeCompare(b.kind));
  }
  // Track public reachability through actual local calls and returns. This
  // prevents a formerly detached fragment acquiring its old "no caller" note.
  const live = new Set<Node>(), visited = new Set<string>();
  const pending = compiled.entries.map((entry) => ({ offset: entry.offset, dispatch: compiled.overlayId, returns: [] as number[] }));
  while (pending.length) {
    const { offset, returns, dispatch } = pending.pop()!, key = `${offset}:${dispatch}:${returns.join(",")}`;
    if (visited.has(key)) continue; visited.add(key);
    if (visited.size > 100_000) return new Map();
    const instruction = instructions.get(offset), node = find(offset);
    if (!instruction || node?.kind !== "code") continue;
    live.add(node);
    if (instruction.opcode >= 1000 && (instruction.dispatchId ?? compiled.overlayId) !== dispatch) { node.invalid = true; continue; }
    const nextDispatch = compiled.overlayId === 58 && instruction.opcode === 0x2c6 ? 60 : compiled.overlayId === 58 && instruction.opcode === 0x2c7 ? 58 : dispatch;
    const enqueue = (next: number, stack = returns) => pending.push({ offset: next, dispatch: nextDispatch, returns: stack });
    if ([2, 0x1d].includes(instruction.opcode)) continue;
    if (instruction.opcode === 5) { if (returns.length) enqueue(returns.at(-1)!, returns.slice(0, -1)); continue; }
    const edges = transfers.get(offset)!;
    if ([4, 0x20].includes(instruction.opcode)) {
      if (returns.length >= 64) return new Map();
      const target = edges.get("call"); if (target !== undefined) enqueue(target, [...returns, instruction.next]);
      if (instruction.opcode === 0x20) enqueue(instruction.next);
    } else { const target = edges.get("jump"); if (target !== undefined) enqueue(target); if (instruction.opcode !== 0x1e) enqueue(instruction.next); }
  }
  const encoder = new TextEncoder(), result = new Map<number, string>();
  for (const root of nodes.filter((n) => n.kind !== "data")) {
    const graph: Node[] = [root], ids = new Map<Node, number>([[root, 0]]), records: unknown[] = [];
    for (let i = 0; i < graph.length; i++) {
      const node = graph[i]; if (node.invalid) break;
      const edges = node.edges.map((edge) => {
        if (!ids.has(edge.target)) { ids.set(edge.target, graph.length); graph.push(edge.target); }
        return [edge.kind, edge.operand, ids.get(edge.target), edge.delta];
      });
      records.push([node.kind, node.end - node.offset, node.hash, node.shape ?? null, edges]);
    }
    if (records.length !== graph.length) continue;
    const entries = compiled.entries.filter((entry) => entry.offset >= root.offset && entry.offset < root.end).map((entry) => [entry.entry, entry.offset - root.offset]);
    const role = root.kind === "movement" ? ["movement", referenced.has(root), entries]
      : [entries.length ? "script" : compiled.helpers.some((h) => h.offset === root.offset) ? "helper" : "block", entries, live.has(root)];
    result.set(root.offset, sha256Hex(encoder.encode(JSON.stringify([BW2_ROUTINE_FINGERPRINT_VERSION, compiled.overlayId ?? null, role, records]))));
  }
  return result;
}

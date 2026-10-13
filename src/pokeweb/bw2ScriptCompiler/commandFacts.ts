import data from "./commandFacts.json";
export type Bw2CommandFact = { opcode: number; overlayId?: number; name: string; legacy: string; description: string; note?: string; parameters: { name: string; width: number; description: string }[]; workOperands: number[] };
export const BW2_COMMAND_FACTS = data.facts as Bw2CommandFact[];
const byName = new Map(BW2_COMMAND_FACTS.map((fact) => [fact.name, fact]));
const byOpcode = new Map(BW2_COMMAND_FACTS.map((fact) => [`${fact.overlayId ?? "base"}:${fact.opcode}`, fact]));
export const bw2CommandFactByName = (name: string): Bw2CommandFact | undefined => byName.get(name);
export const bw2CommandFactByOpcode = (opcode: number, overlayId?: number): Bw2CommandFact | undefined => byOpcode.get(`${opcode < 1000 ? "base" : overlayId}:${opcode}`);

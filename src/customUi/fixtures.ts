import type { GameData, Pokemon } from "./document";
const member = (nickname: string, species: number): Pokemon => ({ nickname, species, form: 0, level: 25, hp: 64, maxHp: 80, status: "Healthy", types: ["Grass"], egg: false,
  evs: { hp: 4, attack: 0, defense: 0, spAttack: 252, spDefense: 0, speed: 252 },
  ivs: { hp: 31, attack: 12, defense: 28, spAttack: 31, spDefense: 30, speed: 31 },
  stats: { hp: 80, attack: 56, defense: 62, spAttack: 74, spDefense: 64, speed: 81 },
  ability: "Overgrow", nature: "Timid", ot: "Rosa", trainerId: "01234", experience: 15625, nextLevelExperience: 1951,
  gender: "female", ball: 3, heldItem: "Miracle Seed", memo: "Timid nature.\nAspertia City\nMet at Lv. 5.",
  moves: [["Tackle", "Normal", "Physical", 50, 100, 35], ["Leaf Tornado", "Grass", "Special", 65, 90, 10], ["Growth", "Normal", "Status", 0, 0, 40], ["Leech Seed", "Grass", "Status", 0, 90, 10]].map(([name, type, category, power, accuracy, pp]) => ({ name: String(name), type: String(type), category: String(category), power: Number(power), accuracy: Number(accuracy), pp: Number(pp), maxPp: Number(pp), description: "A move description for testing wrapped native text." })) });
const base: GameData = { trainer: { name: "Rosa", playTime: "12h 34m", badges: 8 }, location: { name: "Aspertia City" }, party: [], learnsetInstalled: false };
export const fixtures: Record<string, GameData> = {
  empty: structuredClone(base),
  full: { ...structuredClone(base), party: [member("Serperior", 497), member("Emboar", 500), member("Samurott", 503), member("Lucario", 448), member("Zoroark", 571), member("Braviary", 628)] },
  long: { ...structuredClone(base), trainer: { name: "LONG TRAINER NAME", playTime: "999h 59m", badges: 8 }, party: [{ ...member("A VERY LONG POKÉMON NICKNAME", 497), moves: Array.from({ length: 64 }, (_, i) => ({ name: `Long move name ${i + 1}`, type: "Normal", category: "Status", power: 0, accuracy: 100, pp: 10, description: "A longer description that wraps across several lines." })) }] },
  egg: { ...structuredClone(base), party: [{ ...member("Egg", 1), egg: true }] },
};

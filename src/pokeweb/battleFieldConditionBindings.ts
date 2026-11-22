import profiles from "../assets/data/abilityEnvironmentBindings.json";
import { readU32 } from "../nds/binary";
import type { battleRuntimeResolver } from "./battleRuntimeBindings";

export function battleFieldReaderSignatures(game: "B" | "W" | "BW2") {
  const { IsFieldEffectActive, AbilityReadFieldEffect } = profiles.profiles[game];
  return { IsFieldEffectActive, AbilityReadFieldEffect };
}

export function resolveBattleConditionReaders(
  resolver: ReturnType<typeof battleRuntimeResolver>, field: boolean, side: boolean,
  check: (name: string, address: number, size: number) => void,
): number[] {
  const services = [
    ["IsFieldEffectActive", field], ["GetSideFromMonID", side], ["BtlServerFlow_GetSideEffectLayers", side],
  ] as const;
  return services.map(([name, needed]) => {
    if (!needed) return 0;
    const service = resolver.resolve(name);
    check(name, service.address, service.code.length);
    if (name === "IsFieldEffectActive") {
      const target = readU32(service.code, 12), getter = target & ~1;
      if (!(target & 1) || !resolver.matches("AbilityReadFieldEffect", getter)) throw Error("Unrecognized native field-state read.");
      check("AbilityReadFieldEffect", getter, 12);
    }
    return service.address | 1;
  });
}

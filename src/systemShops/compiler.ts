import { NARC } from "../nds/narc";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { compileBw2Script } from "../pokeweb/bw2ScriptCompiler";
import { encodeGen5TextBank, type Gen5TextEntry } from "../pokeweb/text";
import { fingerprint } from "../cgearButtons/compiler";
import {
  MAX_SHOPS,
  MAX_STOCK,
  defaults,
  type Document,
  type Project,
} from "./document";

import { currencyGraphics } from "./graphics";

export const ARCHIVE = "system-shops/shops.narc";
export const RECORD_SIZE = 64 + MAX_STOCK * 8;
export type Assets = {
  names: Map<number, string>;
  items: Uint8Array[];
  pockets: Uint8Array;
  icons: NARC;
  iconMapping: Uint8Array;
  messages: Gen5TextEntry[];
};
export function canUseCurrency(item: number, assets: Assets): boolean {
  return (
    Number.isInteger(item) &&
    item > 0 &&
    !!assets.items[item]?.length &&
    item < assets.pockets.length &&
    assets.pockets[item] !== 2 &&
    assets.pockets[item] !== 4
  );
}
export function validate(document: Document, assets: Assets): string[] {
  const errors: string[] = [],
    ids = new Set<number>();
  if (document.version !== 1 || document.shops.length > MAX_SHOPS)
    errors.push(`Use up to ${MAX_SHOPS} custom shops.`);
  if (
    !Number.isInteger(document.nextId) ||
    document.nextId < 1 ||
    document.nextId > 65536 ||
    document.shops.some((s) => s.id >= document.nextId)
  )
    errors.push("The next shop ID must follow all existing IDs.");
  for (const shop of document.shops) {
    if (
      !Number.isInteger(shop.id) ||
      shop.id < 1 ||
      shop.id > 65535 ||
      ids.has(shop.id)
    )
      errors.push("Shop IDs must be unique positive 16-bit IDs.");
    ids.add(shop.id);
    if (
      !/^[A-Za-z0-9 .,'!?()-]{1,24}$/u.test(shop.name) ||
      shop.name !== shop.name.trim()
    )
      errors.push("Shop names need 1–24 ordinary English characters.");
    if (shop.currency !== 0 && !canUseCurrency(shop.currency, assets))
      errors.push(
        `${shop.name}: currency must be a stackable, non-key bag item.`,
      );
    if (!shop.inventory.length || shop.inventory.length > MAX_STOCK)
      errors.push(`${shop.name}: use 1–${MAX_STOCK} inventory entries.`);
    const stock = new Set<number>();
    for (const row of shop.inventory) {
      if (
        !Number.isInteger(row.item) ||
        row.item < 1 ||
        row.item >= assets.pockets.length ||
        !assets.items[row.item]?.length ||
        stock.has(row.item)
      )
        errors.push(
          `${shop.name}: inventory items must exist and cannot repeat.`,
        );
      stock.add(row.item);
      if (
        !Number.isInteger(row.cost) ||
        row.cost < 1 ||
        row.cost > (shop.currency ? 999 : 9999999)
      )
        errors.push(
          `${shop.name}: costs must be whole numbers from 1 to ${shop.currency ? 999 : 9999999}.`,
        );
    }
  }
  return errors;
}
/** A fixed, trusted script template; the runtime checks its compiled hash. */
export function pickerScript(count: number): Uint8Array {
  return compilePicker(count, true);
}
function compilePicker(count: number, repeat: boolean): Uint8Array {
  if (!Number.isInteger(count) || count < 0 || count > MAX_SHOPS)
    throw new Error("Invalid shop count.");
  return compileBw2Script(`preserve_layout
condition_encoding :stack
work :choice, 0x802a
work :result, 0x802b
${repeat ? "work :reopen, 0x802c" : ""}
script :main, entry: 1 do
  lock
  ${repeat ? "reopen = 1\n  label :picker" : ""}
  list_menu_init_tr 31, 1, 0, 1, 0x802a
  ${Array.from({ length: count + 1 }, (_, i) => `list_menu_add ${i}, 65535, ${i}`).join("\n  ")}
  list_menu_add ${count + 1}, 65535, 65534
  list_menu_show
  if choice <= ${count}
    call_friendly_shop_buy 255, 0x802b
    ${repeat ? "wait_moment\n    jump :picker if reopen != 0" : ""}
  end
  wait_moment
  unlock
  halt
end
`).bytes;
}
function currencyMessages(
  source: Gen5TextEntry[],
  currency: string,
): Uint8Array {
  const entries = source.map((e) => [...e] as Gen5TextEntry);
  const replace = (id: number, text: string) => {
    const e = entries.find((e) => Number(e[0].split("_")[1]) === id);
    if (!e) throw new Error("Unrecognized native shop text bank.");
    e[1] = text;
  };
  replace(3, `You don't have enough ${currency}.\\r`);
  replace(
    5,
    `VAR(265, 0), and you want VAR(513, 1).\\nVAR(518, 2) ${currency}. OK?`,
  );
  replace(7, `No. VAR(513, 0), VAR(263, 1)?\\nVAR(516, 2) ${currency}. OK?`);
  replace(12, "VAR(516, 1)");
  replace(20, currency);
  replace(21, "VAR(518, 0)");
  replace(25, "VAR(518, 0)");
  return encodeGen5TextBank(entries);
}
export function compile(state: Project, assets: Assets): Uint8Array {
  const document = state.applied ?? defaults(),
    errors = validate(document, assets);
  if (errors.length) throw new Error(errors.join("\n"));
  const arc = new NARC(),
    config = new Uint8Array(32 + document.shops.length * RECORD_SIZE);
  const script = pickerScript(document.shops.length);
  const menu = encodeGen5TextBank(
    ["Pokémart", ...document.shops.map((s) => s.name), "Cancel"].map(
      (name, i) => [`0_${i}`, name, 0],
    ),
  );
  writeU32(config, 0, 0x50485353);
  writeU16(config, 4, 1);
  writeU16(config, 6, RECORD_SIZE);
  writeU16(config, 8, document.shops.length);
  for (const [i, shop] of document.shops.entries()) {
    const at = 32 + i * RECORD_SIZE;
    writeU16(config, at, shop.id);
    writeU16(config, at + 2, shop.currency);
    writeU16(config, at + 4, shop.inventory.length);
    for (const [n, char] of [...shop.name].entries())
      writeU16(config, at + 8 + n * 2, char.charCodeAt(0));
    for (const [n, row] of shop.inventory.entries()) {
      writeU16(config, at + 64 + n * 8, row.item);
      writeU32(config, at + 68 + n * 8, row.cost);
    }
  }
  arc.files = [
    config,
    new TextEncoder().encode(JSON.stringify(state)),
    script,
    menu,
    ...document.shops.map((s) =>
      s.currency
        ? currencyMessages(
            assets.messages,
            assets.names.get(s.currency) ?? `Item ${s.currency}`,
          )
        : encodeGen5TextBank(assets.messages),
    ),
  ];
  for (const shop of document.shops)
    arc.files.push(
      ...currencyGraphics(shop.currency, assets.icons, assets.iconMapping),
    );
  for (let i = 0; i < document.shops.length; i++) {
    writeU32(config, 32 + i * RECORD_SIZE + 56, fingerprint(arc.files[4 + i]));
    writeU32(
      config,
      32 + i * RECORD_SIZE + 60,
      fingerprint(
        new Uint8Array([
          ...arc.files[4 + document.shops.length + i * 2],
          ...arc.files[5 + document.shops.length + i * 2],
        ]),
      ),
    );
  }
  writeU32(config, 12, fingerprint(config.subarray(32)));
  writeU32(config, 16, config.length);
  writeU32(config, 20, fingerprint(script));
  writeU32(config, 24, fingerprint(menu));
  writeU32(
    config,
    28,
    fingerprint(
      new Uint8Array(arc.files.slice(4).flatMap((b) => Array.from(b))),
    ),
  );
  return arc.save();
}
export function recover(bytes: Uint8Array): Project {
  const arc = new NARC(bytes),
    h = arc.files[0];
  if (!h || h.length < 32 || arc.files.length < 4)
    throw new Error("Incomplete System Shop archive.");
  const count = readU16(h, 8);
  // Recover the original one-shot picker so existing exported shops upgrade
  // without changing their authored inventories, currency, or draft edits.
  const trustedPickers = [pickerScript(count), compilePicker(count, false)];
  if (
    readU32(h, 0) !== 0x50485353 ||
    readU16(h, 4) !== 1 ||
    readU16(h, 6) !== RECORD_SIZE ||
    count > MAX_SHOPS ||
    h.length !== 32 + count * RECORD_SIZE ||
    readU32(h, 16) !== h.length ||
    arc.files.length !== 4 + count * 3 ||
    readU32(h, 12) !== fingerprint(h.subarray(32)) ||
    readU32(h, 20) !== fingerprint(arc.files[2]) ||
    !trustedPickers.some((expected) =>
      arc.files[2].length === expected.length &&
      arc.files[2].every((v, i) => v === expected[i])) ||
    readU32(h, 24) !== fingerprint(arc.files[3]) ||
    readU32(h, 28) !==
      fingerprint(
        new Uint8Array(arc.files.slice(4).flatMap((b) => Array.from(b))),
      )
  )
    throw new Error("System Shop archive failed its integrity check.");
  const state = JSON.parse(new TextDecoder().decode(arc.files[1])) as Project;
  const sourceShape = (d: Document) =>
    d?.version === 1 &&
    Number.isInteger(d.nextId) &&
    d.nextId > 0 &&
    d.nextId <= 65536 &&
    Array.isArray(d.shops) &&
    d.shops.length <= MAX_SHOPS &&
    d.shops.every(
      (s) =>
        s &&
        Number.isInteger(s.id) &&
        s.id > 0 &&
        s.id < d.nextId &&
        typeof s.name === "string" &&
        s.name.length <= 24 &&
        Number.isInteger(s.currency) &&
        Array.isArray(s.inventory) &&
        s.inventory.length <= MAX_STOCK &&
        s.inventory.every(
          (r) =>
            r &&
            (typeof r.item === "number" || r.item === null) &&
            (typeof r.cost === "number" || r.cost === null),
        ),
    );
  if (
    !sourceShape(state.document) ||
    (state.applied && !sourceShape(state.applied)) ||
    (state.applied ?? defaults()).shops.length !== count
  )
    throw new Error("Invalid System Shop source metadata.");
  // Drafts may intentionally contain invalid edits. The applied source must
  // nevertheless describe exactly the stock and names used by the runtime.
  const applied = state.applied ?? defaults(),
    expectedRecords = new Uint8Array(count * RECORD_SIZE);
  for (const [i, shop] of applied.shops.entries()) {
    const at = i * RECORD_SIZE;
    writeU16(expectedRecords, at, shop.id);
    writeU16(expectedRecords, at + 2, shop.currency);
    writeU16(expectedRecords, at + 4, shop.inventory.length);
    for (const [n, char] of [...shop.name].entries())
      writeU16(expectedRecords, at + 8 + n * 2, char.charCodeAt(0));
    writeU32(expectedRecords, at + 56, fingerprint(arc.files[4 + i]));
    writeU32(
      expectedRecords,
      at + 60,
      fingerprint(
        new Uint8Array([
          ...arc.files[4 + count + i * 2],
          ...arc.files[5 + count + i * 2],
        ]),
      ),
    );
    for (const [n, row] of shop.inventory.entries()) {
      writeU16(expectedRecords, at + 64 + n * 8, row.item);
      writeU32(expectedRecords, at + 68 + n * 8, row.cost);
    }
  }
  const menu = encodeGen5TextBank(
    ["Pokémart", ...applied.shops.map((s) => s.name), "Cancel"].map(
      (name, i) => [`0_${i}`, name, 0],
    ),
  );
  if (
    !h.subarray(32).every((v, i) => v === expectedRecords[i]) ||
    arc.files[3].length !== menu.length ||
    !menu.every((v, i) => v === arc.files[3][i])
  )
    throw new Error(
      "System Shop compiled data differs from its applied source.",
    );
  return state;
}

import { NintendoDSRom } from "../nds/rom";
import { loadActiveRomBytes } from "../pokeweb/persistence";
import type { ProjectState } from "../pokeweb/projectStore";
import {
  ensureSystemShops,
  hydrateSystemShops,
  systemShopAssets,
} from "../pokeweb/systemShopsModel";
import { installCGearQuickActions } from "../pokeweb/cgearQuickActionsModel";
import { getTmEntries, tmFieldItemId } from "../pokeweb/tmModel";
import {
  MAX_SHOPS,
  MAX_STOCK,
  MAX_SAVE_FLAG,
  newShop,
} from "../systemShops/document";
import { canUseCurrency, validate, validCondition } from "../systemShops/compiler";
import { escapeHtml as esc } from "./dom";

export async function renderSystemShopsEditor(
  project: ProjectState,
  root: HTMLElement,
  onDirty: () => void,
) {
  root.innerHTML =
    '<section class="system-shops"><h1>C-Gear Shops</h1><p>Loading native items…</p></section>';
  try {
    const bytes = project.originalRomBytes ?? (await loadActiveRomBytes());
    if (!bytes) throw new Error("Reload the ROM to edit C-Gear Shops.");
    const rom = new NintendoDSRom(bytes, { fileData: "view" });
    hydrateSystemShops(project, rom);
    const assets = systemShopAssets(project, rom);
    let selected = ensureSystemShops(project).document.shops[0]?.id,
      busy: "apply" | "dependencies" | undefined,
      message = "";
    const machineMoves = new Map(
      getTmEntries(project).map((entry) => [
        tmFieldItemId(entry.field),
        project.texts.banks.moves?.[entry.moveId] ?? entry.moveName,
      ]),
    );
    const labels = new Map(
      [...assets.names]
        .filter(
          ([id]) =>
            id > 0 && id < assets.pockets.length && assets.items[id]?.length,
        )
        .map(([id, name]) => [
          id,
          `${name}${machineMoves.has(id) ? ` — ${machineMoves.get(id)}` : ""} (#${id})`,
        ]),
    );
    function changed() {
      message = "";
      onDirty();
      draw();
    }
    function draw() {
      if (!root.isConnected || !root.querySelector(".system-shops")) return;
      const state = ensureSystemShops(project),
        document = state.document,
        shop = document.shops.find((s) => s.id === selected);
      const pending =
        JSON.stringify(document) !==
        JSON.stringify(state.applied ?? { version: 1, nextId: 1, shops: [] });
      const errors = validate(document, assets);
      root.innerHTML = `<section class="system-shops"><header><h1>C-Gear Shops</h1><div class="ss-header-actions"><button class="ss-dependencies" ${busy ? "disabled" : ""}>${busy === "dependencies" ? "Installing…" : "Install Dependencies"}</button><button class="ss-apply" ${busy || errors.length ? "disabled" : ""}>${busy === "apply" ? "Applying…" : "Apply Changes"}</button></div></header>
        <p role="status" class="ss-status">${esc(message ? `${message}${pending ? " Unapplied changes" : ""}` : pending ? "Unapplied changes" : "Applied configuration is up to date")}</p>
        <fieldset ${busy ? "disabled" : ""}><div class="ss-layout"><aside><h2>Custom shops <small>${document.shops.length} / ${MAX_SHOPS}</small></h2><p class="ss-native">Pokémart</p>
        ${document.shops.map((s) => `<button class="ss-shop ${s.id === selected ? "-selected" : ""}" data-shop="${s.id}">${esc(s.name || "Unnamed shop")}</button>`).join("")}
        <button class="ss-add" id="ss-add-shop" ${document.shops.length >= MAX_SHOPS ? "disabled" : ""}>+ Add Shop</button></aside>
        <article>${
          shop
            ? `<div class="ss-properties"><label>Shop name<input id="ss-name" value="${esc(shop.name)}" maxlength="24"></label><label>Currency<select id="ss-currency"><option value="0">Poké Dollars</option>${[
                ...labels,
              ]
                .filter(([id]) => canUseCurrency(id, assets))
                .map(
                  ([id, label]) =>
                    `<option value="${id}" ${id === shop.currency ? "selected" : ""}>${esc(label)}</option>`,
                )
                .join(
                  "",
                )}</select></label><button class="ss-delete" id="ss-delete-shop">× Delete Shop</button></div>
        <table><thead><tr><th>Item</th><th>Cost</th><th>Min. badges</th><th>Save flag</th><th></th></tr></thead><tbody>${shop.inventory.map((row, i) => `<tr><td><input data-ss-item="${i}" list="ss-item-options" value="${esc(labels.get(row.item) ?? String(row.item))}" aria-label="Inventory item ${i + 1}"></td><td><input data-ss-cost="${i}" type="number" min="1" max="${shop.currency ? 999 : 9999999}" step="1" value="${row.cost}" aria-label="Cost ${i + 1}"></td><td><select data-ss-badges="${i}" aria-label="Minimum badges ${i + 1}">${Array.from({length:9},(_,n)=>`<option value="${n}" ${(row.condition?.badges ?? 0) === n ? "selected" : ""}>${n === 0 ? "None" : n}</option>`).join("")}</select></td><td><div class="ss-flag"><input data-ss-flag="${i}" value="${row.condition?.flag ? esc(Number.isInteger(row.condition.flag.id) ? `0x${row.condition.flag.id.toString(16).toUpperCase()}` : "") : ""}" placeholder="None" aria-label="Save flag ${i + 1}" spellcheck="false"><select data-ss-flag-state="${i}" aria-label="Flag condition ${i + 1}" ${row.condition?.flag ? "" : "disabled"}><option value="set" ${row.condition?.flag?.state !== "clear" ? "selected" : ""}>Set</option><option value="clear" ${row.condition?.flag?.state === "clear" ? "selected" : ""}>Clear</option></select></div></td><td><button class="ss-delete" data-ss-remove="${i}" aria-label="Remove item ${i + 1}">×</button></td></tr>`).join("")}</tbody></table>
        <button class="ss-add" id="ss-add-item" ${shop.inventory.length >= MAX_STOCK ? "disabled" : ""}>+ Add Item</button><span class="ss-count">${shop.inventory.length} / ${MAX_STOCK} items</span>
        <datalist id="ss-item-options">${[...labels.values()].map((label) => `<option value="${esc(label)}"></option>`).join("")}</datalist>`
            : "<h2>Custom inventory</h2>"
        }
        <div class="ss-validation">${errors.length ? `<ul class="ss-errors">${errors.map((error) => `<li>${esc(error)}</li>`).join("")}</ul>` : ""}</div></article></div></fieldset>
        </section>`;
      root.querySelectorAll<HTMLButtonElement>("[data-shop]").forEach(
        (button) =>
          (button.onclick = () => {
            selected = Number(button.dataset.shop);
            draw();
          }),
      );
      root.querySelector<HTMLButtonElement>("#ss-add-shop")!.onclick = () => {
        const s = newShop(document);
        document.shops.push(s);
        selected = s.id;
        changed();
      };
      if (shop) {
        root.querySelector<HTMLInputElement>("#ss-name")!.onchange = (e) => {
          shop.name = (e.target as HTMLInputElement).value;
          changed();
        };
        root.querySelector<HTMLSelectElement>("#ss-currency")!.onchange = (
          e,
        ) => {
          shop.currency = Number((e.target as HTMLSelectElement).value);
          changed();
        };
        root.querySelector<HTMLButtonElement>("#ss-delete-shop")!.onclick =
          () => {
            document.shops = document.shops.filter((s) => s.id !== shop.id);
            selected = document.shops[0]?.id;
            changed();
          };
        root.querySelector<HTMLButtonElement>("#ss-add-item")!.onclick = () => {
          const item =
            [...labels.keys()].find(
              (id) => !shop.inventory.some((row) => row.item === id),
            ) ?? 4;
          shop.inventory.push({ item, cost: 1 });
          changed();
        };
        root.querySelectorAll<HTMLInputElement>("[data-ss-item]").forEach(
          (input) =>
            (input.onchange = () => {
              const value = input.value,
                match = value.match(/#(\d+)\)$/u);
              const id = match ? Number(match[1]) : Number(value);
              shop.inventory[Number(input.dataset.ssItem)].item = id;
              changed();
            }),
        );
        root.querySelectorAll<HTMLInputElement>("[data-ss-cost]").forEach(
          (input) =>
            (input.onchange = () => {
              shop.inventory[Number(input.dataset.ssCost)].cost = Number(
                input.value,
              );
              changed();
            }),
        );
        function pruneCondition(index: number) {
          const row = shop!.inventory[index];
          if (!row.condition?.badges && !row.condition?.flag) delete row.condition;
        }
        root.querySelectorAll<HTMLSelectElement>("[data-ss-badges]").forEach(input => {
          input.onchange = () => {
            const index = Number(input.dataset.ssBadges), row = shop.inventory[index];
            (row.condition ??= {}).badges = Number(input.value);
            pruneCondition(index);
            changed();
          };
        });
        root.querySelectorAll<HTMLInputElement>("[data-ss-flag]").forEach(input => {
          const updateFlag = () => {
            const index = Number(input.dataset.ssFlag), row = shop.inventory[index];
            if (input.value.trim()) {
              (row.condition ??= {}).flag = { id: Number(input.value), state: row.condition?.flag?.state ?? "set" };
            } else if (row.condition) delete row.condition.flag;
            pruneCondition(index);
          };
          input.oninput = () => {
            updateFlag();
            // Keep focus while typing a partial hexadecimal number. The draft
            // autosaves immediately; compilation still requires a valid flag.
            const stateSelect = root.querySelector<HTMLSelectElement>(`[data-ss-flag-state="${input.dataset.ssFlag}"]`)!;
            stateSelect.disabled = !shop.inventory[Number(input.dataset.ssFlag)].condition?.flag;
            const errors = validate(document, assets);
            root.querySelector<HTMLButtonElement>(".ss-apply")!.disabled = !!busy || errors.length > 0;
            root.querySelector(".ss-validation")!.innerHTML = errors.length ? `<ul class="ss-errors">${errors.map(error => `<li>${esc(error)}</li>`).join("")}</ul>` : "";
            input.setAttribute("aria-invalid", String(!validCondition(shop.inventory[Number(input.dataset.ssFlag)].condition)));
            message = "";
            root.querySelector(".ss-status")!.textContent = "Unapplied changes";
            onDirty();
          };
          input.onchange = () => { updateFlag(); changed(); };
          input.title = `Saved flag: 1–${MAX_SAVE_FLAG} (decimal or hex)`;
        });
        root.querySelectorAll<HTMLSelectElement>("[data-ss-flag-state]").forEach(input => {
          input.onchange = () => {
            const row = shop.inventory[Number(input.dataset.ssFlagState)];
            if (row.condition?.flag) row.condition.flag.state = input.value as "set" | "clear";
            changed();
          };
        });
        root.querySelectorAll<HTMLButtonElement>("[data-ss-remove]").forEach(
          (button) =>
            (button.onclick = () => {
              shop.inventory.splice(Number(button.dataset.ssRemove), 1);
              changed();
            }),
        );
      }
      async function install(applyShops: boolean) {
        busy = applyShops ? "apply" : "dependencies";
        message = "";
        draw();
        try {
          await installCGearQuickActions(project, { applySystemShops: applyShops });
          message = applyShops ? "Changes applied." : "Dependencies installed.";
          onDirty();
        } catch (error) {
          message = (error as Error).message;
        } finally {
          busy = undefined;
          draw();
        }
      }
      root.querySelector<HTMLButtonElement>(".ss-dependencies")!.onclick = () =>
        install(false);
      root.querySelector<HTMLButtonElement>(".ss-apply")!.onclick = () =>
        install(true);
    }
    draw();
  } catch (error) {
    root.innerHTML = `<section class="system-shops"><h1>C-Gear Shops</h1><p class="ss-errors">${esc((error as Error).message)}</p></section>`;
  }
}

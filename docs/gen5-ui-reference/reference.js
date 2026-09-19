/* Standalone documentation demo. No app imports, storage, ROM access, or requests. */
(() => {
  "use strict";

  const original = [
    { id: 497, name: "Serperior", sprite: "serperior", types: ["Grass"], ability: "Overgrow / Contrary", stats: [75, 75, 95, 75, 95, 113] },
    { id: 503, name: "Samurott", sprite: "samurott", types: ["Water"], ability: "Torrent / Shell Armor", stats: [95, 100, 85, 108, 70, 70] },
    { id: 609, name: "Chandelure", sprite: "chandelure", types: ["Ghost", "Fire"], ability: "Flash Fire / Flame Body", stats: [60, 55, 90, 145, 90, 80] },
    { id: 530, name: "Excadrill", sprite: "excadrill", types: ["Ground", "Steel"], ability: "Sand Rush / Sand Force", stats: [110, 135, 60, 50, 65, 88] },
  ];
  const statNames = ["HP", "Attack", "Defense", "Sp. Atk", "Sp. Def", "Speed"];
  const shortStats = ["HP", "ATK", "DEF", "SPA", "SPD", "SPE"];
  const root = document.querySelector(".g5-reference");
  const recordsHost = root.querySelector("#records");
  const search = root.querySelector("#species-search");
  const longLabel = root.querySelector("#long-label");
  const resetDialog = root.querySelector("#reset-dialog");
  let records = original.map(record => ({ ...record, stats: [...record.stats] }));
  let selectedType = "all";

  // Interpolation is restricted to the fixed sample data above; user drafts are
  // assigned through input values or textContent and never inserted as HTML.
  function renderRecords() {
    recordsHost.innerHTML = records.map((record, recordIndex) => {
      const expanded = recordIndex === 0;
      return `<article class="record${expanded ? " expanded" : ""}" data-record="${record.id}" aria-labelledby="name-${record.id}">
        <div class="record-main">
          <div class="record-identity">
            <img class="record-sprite" src="assets/${record.sprite}.png" width="80" height="60" alt="">
            <div class="record-name"><span class="record-id">NO. ${record.id}</span><h4 id="name-${record.id}">${record.name}</h4><div class="badges">${record.types.map(type => `<span class="type-badge type-${type}">${type}</span>`).join("")}</div></div>
          </div>
          <dl class="stats" aria-label="Base statistics for ${record.name}">${record.stats.map((value, index) => `<div><dt><abbr title="${statNames[index]}">${shortStats[index]}</abbr></dt><dd data-value="${index}">${value}</dd></div>`).join("")}</dl>
        </div>
        <div class="record-bottom"><p class="ability"><span>Abilities</span>${record.ability}</p><button type="button" class="expand-button" aria-expanded="${expanded}" aria-controls="details-${record.id}" aria-label="${expanded ? "Collapse" : "Expand"} ${record.name}"><span class="expand-label">${expanded ? "Close details" : "Edit personal"}</span> <span class="expand-mark" aria-hidden="true">${expanded ? "−" : "+"}</span></button></div>
        <section id="details-${record.id}" class="record-details" aria-label="${record.name} personal details" ${expanded ? "" : "hidden"}>
          <div class="detail-title"><h4>Base statistics</h4><p id="range-${record.id}">Whole numbers from 1 to 255</p></div>
          <div class="stat-fields">${record.stats.map((value, index) => `<div class="stat-field"><label for="stat-${record.id}-${index}">${statNames[index]}</label><input id="stat-${record.id}-${index}" aria-label="${statNames[index]} for ${record.name}" type="number" min="1" max="255" step="1" required value="${value}" data-stat="${index}" aria-describedby="range-${record.id} error-${record.id}-${index}"><p class="field-error" id="error-${record.id}-${index}" hidden>Enter a whole number from 1 to 255.</p></div>`).join("")}</div>
          <p class="detail-note">Changes update this sample card immediately. Reloading restores the example data.</p>
        </section>
      </article>`;
    }).join("");
  }

  function applyFilters() {
    const term = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const record of records) {
      const card = recordsHost.querySelector(`[data-record="${record.id}"]`);
      const name = card.querySelector("h4").textContent;
      const matches = `${record.id} ${name}`.toLocaleLowerCase().includes(term)
        && (selectedType === "all" || record.types.includes(selectedType));
      card.hidden = !matches;
      if (matches) visible++;
    }
    root.querySelector("#result-count").textContent = `${visible} of ${records.length} records`;
    root.querySelector("#empty-results").hidden = visible > 0;
    for (const button of root.querySelectorAll("[data-type]")) {
      button.setAttribute("aria-pressed", String(button.dataset.type === selectedType));
    }
  }

  function clearFilters() {
    search.value = "";
    selectedType = "all";
    applyFilters();
  }

  function isValidStat(input) {
    const value = input.valueAsNumber;
    return input.value !== "" && input.validity.valid && Number.isInteger(value) && value >= 1 && value <= 255;
  }

  function updateChangeStatus() {
    const count = records.reduce((total, record, index) => total + record.stats.filter((value, stat) => value !== original[index].stats[stat]).length, 0);
    const invalid = recordsHost.querySelectorAll('[aria-invalid="true"]').length;
    const status = root.querySelector("#change-status");
    status.classList.toggle("changed", count > 0 || invalid > 0);
    status.textContent = invalid
      ? `${invalid} invalid draft${invalid === 1 ? "" : "s"} · ${count} sample change${count === 1 ? "" : "s"}`
      : count ? `● ${count} sample change${count === 1 ? "" : "s"}` : "Sample data · unchanged";
  }

  recordsHost.addEventListener("click", event => {
    const button = event.target.closest(".expand-button");
    if (!button) return;
    const card = button.closest(".record");
    const record = records.find(item => item.id === Number(card.dataset.record));
    const expanded = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${record.name}`);
    button.querySelector(".expand-label").textContent = expanded ? "Close details" : "Edit personal";
    button.querySelector(".expand-mark").textContent = expanded ? "−" : "+";
    card.classList.toggle("expanded", expanded);
    card.querySelector(".record-details").hidden = !expanded;
  });

  recordsHost.addEventListener("input", event => {
    const input = event.target.closest("[data-stat]");
    if (!input) return;
    const card = input.closest(".record");
    const record = records.find(item => item.id === Number(card.dataset.record));
    const index = Number(input.dataset.stat);
    const valid = isValidStat(input);
    input.setAttribute("aria-invalid", String(!valid));
    root.querySelector(`#error-${record.id}-${index}`).hidden = valid;
    if (valid) {
      record.stats[index] = input.valueAsNumber;
      card.querySelector(`[data-value="${index}"]`).textContent = input.value;
    }
    updateChangeStatus();
  });

  search.addEventListener("input", applyFilters);
  for (const button of root.querySelectorAll("[data-type]")) {
    button.addEventListener("click", () => {
      selectedType = button.dataset.type;
      applyFilters();
    });
  }
  root.querySelector("#clear-filters").addEventListener("click", clearFilters);
  root.querySelector("#empty-clear").addEventListener("click", () => {
    clearFilters();
    search.focus(); // The empty-state action disappears after clearing.
  });
  longLabel.addEventListener("change", () => {
    root.querySelector("#name-497").textContent = longLabel.checked
      ? "Serperior — extended regional form name for layout verification"
      : "Serperior";
    applyFilters();
  });
  root.querySelector("#reset-sample").addEventListener("click", () => {
    resetDialog.returnValue = "";
    resetDialog.showModal();
  });
  resetDialog.addEventListener("close", () => {
    if (resetDialog.returnValue !== "reset") return;
    records = original.map(record => ({ ...record, stats: [...record.stats] }));
    longLabel.checked = false;
    renderRecords();
    clearFilters();
    updateChangeStatus();
  });
  root.querySelector("#example-stat").addEventListener("input", event => {
    const valid = isValidStat(event.target);
    event.target.setAttribute("aria-invalid", String(!valid));
    const feedback = root.querySelector("#example-error");
    feedback.textContent = valid ? "Valid sample value." : "Enter a whole number from 1 to 255.";
    feedback.classList.toggle("field-valid", valid);
  });
  for (const radio of root.querySelectorAll('[name="detail"]')) {
    radio.setAttribute("aria-describedby", "option-help");
    radio.addEventListener("change", () => {
      root.querySelector("#option-help").textContent = radio.value === "compact"
        ? "Compact preview keeps the essential identity and statistics in view."
        : "Extended preview adds contextual information beneath the selected record.";
    });
  }

  renderRecords();
  applyFilters();
})();

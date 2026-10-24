import type { ProjectState } from "../pokeweb/projectStore";
import { FLAG_CATEGORIES, badgeReference, flagMatches, isImportantFlag, projectFlagReference, type FlagCategory, type FlagEntry } from "../pokeweb/flagReferenceModel";
import { escapeHtml as esc } from "./dom";
const hex=(n:number)=>`0x${n.toString(16).toUpperCase().padStart(4,"0")}`;
const groupNames:Record<string,string>={trainers:"Documented trainer events",items:"Documented item pickups","npc-visibility":"Observed NPC visibility flags"};
export function renderFlagReference(project:ProjectState,root:HTMLElement) {
  const family=project.session.baseRom;
  if (family!=="BW"&&family!=="BW2") {root.innerHTML="<h1>Flag Reference</h1><p>Black/White and Black 2/White 2 only.</p>";return;}
  const gameFamily: "BW" | "BW2" = family;
  let entries:FlagEntry[];
  try { entries=projectFlagReference(project); }
  catch(error) {root.innerHTML=`<h1>Flag Reference</h1><p>${esc((error as Error).message)}</p>`;return;}
  let category:FlagCategory="important", query="", usedOnly=false;
  root.innerHTML=`<section class="flag-reference"><header><h1>Flag Reference <small>${family==="BW"?"Black / White":"Black 2 / White 2"}</small></h1>
    <input type="search" id="flag-search" placeholder="Search a name, decimal ID or 0x flag…" aria-label="Search flags"></header>
    <nav role="tablist" aria-label="Flag categories">${FLAG_CATEGORIES.map(([id,label])=>`<button role="tab" id="flag-tab-${id}" data-flag-category="${id}" aria-controls="flag-results">${label}</button>`).join("")}</nav>
    <div class="flag-filters"><label><input id="flag-used" type="checkbox"> Referenced by loaded ROM / patch settings only</label><span id="flag-count" role="status"></span></div>
    <p class="flag-note">Public event notes and references from the loaded ROM. Undocumented purposes remain unknown; this is not a complete list of every native flag use. Compatible hacks can reuse flags. This page does not read a player's save.</p>
    <div id="flag-results" role="tabpanel" tabindex="0"></div>
    <footer>English event notes: <a href="https://github.com/kwsch/PKHeX/tree/13110adfd738c1f99c82689b4943168a8dc8e2f0/PKHeX.Core/Resources/text/script/gen5" target="_blank" rel="noopener">PKHeX</a>. Script/NPC references come from the loaded ROM; patch references use applied/draft settings. Native-only and dynamic uses may not appear in that filter.</footer></section>`;
  const results=root.querySelector<HTMLElement>("#flag-results")!;
  const sourceLabel={"public-notes":"Public English note · PKHeX",rom:"Observed in loaded ROM · purpose unnamed",patch:"Authored patch setting"};
  const row=(entry:FlagEntry)=>`<tr><td><button class="flag-id" data-copy-flag="${entry.id}" title="Copy ${hex(entry.id)}">${hex(entry.id)}</button><small>${entry.id}</small></td><td>${esc(entry.label)}<small>${sourceLabel[entry.source]}</small></td><td>${entry.uses?.length?`<details><summary>${entry.uses.length} references</summary><ul>${entry.uses.map(use=>`<li>${esc(use)}</li>`).join("")}</ul></details>`:"—"}</td></tr>`;
  const table=(rows:FlagEntry[])=>`<table><thead><tr><th>Flag ID</th><th>Tracks</th><th>Loaded ROM</th></tr></thead><tbody>${rows.map(row).join("")}</tbody></table>`;
  function draw() {
    root.querySelectorAll<HTMLButtonElement>("[data-flag-category]").forEach(button=>{
      const selected=button.dataset.flagCategory===category;
      button.setAttribute("aria-selected",String(selected));button.tabIndex=selected?0:-1;
    });
    results.setAttribute("aria-labelledby",`flag-tab-${category}`);
    const visible=entries.filter(entry=>(category==="all"||category==="important"&&isImportantFlag(entry)||entry.category===category||category==="patches"&&entry.uses?.some(use=>use.startsWith("Patch ·")))&&flagMatches(entry,query)&&(!usedOnly||entry.uses?.length));
    root.querySelector("#flag-count")!.textContent=`${visible.length} ${visible.length === 1 ? "flag" : "flags"}`;
    const ordinary=visible.filter(e=>!e.group), grouped=visible.filter(e=>e.group);
    const groups=[...new Set(grouped.map(e=>e.group!))];
    const badges=category==="important"||query.trim()?badgeReference(gameFamily).filter(b=>!query||/badge|gym|leader/iu.test(query)||b.name.toLowerCase().includes(query.toLowerCase())):[];
    results.innerHTML=(badges.length?`<section class="flag-badges"><h2>Gym badges</h2><p>Badge ownership is an eight-bit field in trainer data, not eight event-flag IDs. In C-Gear Shops, use Min. badges for progression.</p><table><thead><tr><th>Badge</th><th>Leader / name</th><th>Trainer-data bit mask</th></tr></thead><tbody>${badges.map(b=>`<tr><td>${b.index+1}</td><td>${esc(b.name)}</td><td><code>${hex(b.mask)}</code></td></tr>`).join("")}</tbody></table></section>`:"")+
      (ordinary.length?table(ordinary):"")+groups.map(group=>{
        const rows=grouped.filter(e=>e.group===group);
        return `<details class="flag-family" ${query?"open":""}><summary>${esc(groupNames[group]??group)} · ${rows.length} entries · ${hex(rows[0].id)}–${hex(rows.at(-1)!.id)}</summary>${table(rows)}</details>`;
      }).join("")+(!visible.length&&!badges.length?"<p>No matching flags.</p>":"");
    results.querySelectorAll<HTMLButtonElement>("[data-copy-flag]").forEach(button=>button.onclick=async()=>{
      try {await navigator.clipboard.writeText(hex(Number(button.dataset.copyFlag)));button.title="Copied";}
      catch {button.title="Select and copy the flag ID";}
    });
  }
  const tabs=[...root.querySelectorAll<HTMLButtonElement>("[data-flag-category]")];
  tabs.forEach((button,index)=>{
    button.onclick=()=>{category=button.dataset.flagCategory as FlagCategory;draw();};
    button.onkeydown=event=>{
      if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
      event.preventDefault();const next=event.key==="Home"?0:event.key==="End"?tabs.length-1:(index+(event.key==="ArrowRight"?1:tabs.length-1))%tabs.length;
      tabs[next].click();tabs[next].focus();
    };
  });
  root.querySelector<HTMLInputElement>("#flag-search")!.oninput=event=>{query=(event.target as HTMLInputElement).value;if(query) category="all";draw();};
  root.querySelector<HTMLInputElement>("#flag-used")!.onchange=event=>{usedOnly=(event.target as HTMLInputElement).checked;draw();};
  draw();
}

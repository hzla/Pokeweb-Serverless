import { nativeAbilityProfile } from "../pokeweb/abilityNativeRuntime";
import { optimizeAbilityRule } from "../pokeweb/abilityRecipeOptimization";
import { ABILITY_IMPORT_LIBRARY, abilityImport } from "../pokeweb/abilityLibrary";
import type { ProjectState } from "../pokeweb/projectStore";
import { inspectAbilityEffects, configureAbilityRuleSets, createCustomAbility, nextCustomAbilityId, clearAbilityRules } from "../pokeweb/abilityEffectsModel";
import { ABILITY_NATIVE_EFFECTS, ABILITY_RULE_EFFECTS, ABILITY_RULE_PRESETS, EMPTY_ABILITY_RULE, type AbilityRuleSet } from "../pokeweb/abilityRules";
import { renderItemRuleForm, installItemRuleEditor, type RuleFormOptions } from "./itemRuleEditor";
import { escapeHtml } from "./dom";
import { installAbilityPrimitiveReference } from "./abilityPrimitiveReference";
import { abilityChanges, displayAbilityName, getAbilityDescription, getAbilitySummaryName, updateAbilityDescription, type AbilityChange } from "../pokeweb/abilityTextModel";
import { descriptionPreviewMarkup, installLazyDescriptionPreview } from "./lazyDescriptionPreview";
import { renderAbilityRuntimeUpdate, installAbilityRuntimeUpdate, refreshAbilityRuntimeUpdate } from "./abilityRuntimeUpdate";

export const BLANK_ABILITY_DRAFT:AbilityRuleSet={effects:[],conditions:{kind:"group",mode:"all",children:[]}};
type AbilityFilter="all"|"new"|"edited";
const FILTER_LABELS:Record<AbilityFilter,string>={all:"All",new:"New",edited:"Edited"};
/** What a row's tooltip says changed, e.g. "Edited: name, battle effects". */
function changeSummary(change:AbilityChange):string{
    if(change.added)return "Added ability";
    return `Edited: ${[change.renamed&&"name",change.described&&"description",change.effects&&"battle effects"].filter(Boolean).join(", ")}`;
}
export function renderAbilityEditor(project: ProjectState, root: HTMLElement, onChange: () => void): void {
    let selected=1,previous=1,query="",customDraft=false,adding=false,newDescription="";
    // New and edited abilities, against the unmodified game; refreshed with each panel and description change.
    let filter:AbilityFilter="all",changes=new Map<number,AbilityChange>(),customRules:ReadonlyMap<number,AbilityRuleSet>=new Map(),editable=false;
    let descriptionPreview:ReturnType<typeof installLazyDescriptionPreview>|undefined;
    const options:RuleFormOptions={
        ability:true,
        definitions:[...ABILITY_RULE_EFFECTS,...ABILITY_NATIVE_EFFECTS.map(d=>({...d,label:displayAbilityName(d.nativeItem,project.texts.banks.abilities?.[d.nativeItem]??d.label)}))],
        presets:[...ABILITY_IMPORT_LIBRARY.map(p=>({id:p.id,label:p.label,group:p.group??`Generation ${p.generation}`})),...ABILITY_RULE_PRESETS.map(p=>({id:p.id,label:displayAbilityName(p.id,p.label),group:project.session.baseRom === "BW" ? "BW templates" : "BW2 templates"}))],
        preset:id=>({...structuredClone(id>164?abilityImport(id).rule:ABILITY_RULE_PRESETS.find(p=>p.id===id)!.rule),consumable:false}),
        imported:id=>{const name=root.querySelector<HTMLInputElement>("[data-ability-name]")!;if(!name.value.trim())name.value=id>164?abilityImport(id).defaultName:displayAbilityName(id,ABILITY_RULE_PRESETS.find(p=>p.id===id)!.label).slice(0,15);descriptionPreview?.refresh();},
        apply:async rule=>{
            const name=root.querySelector<HTMLInputElement>("[data-ability-name]")!.value;
            const field=root.querySelector<HTMLTextAreaElement>("[data-ability-description]");
            const description=field&&!field.disabled?field.value:undefined;
            if(adding){selected=await createCustomAbility(project,name,rule,description);adding=false;query="";root.querySelector<HTMLInputElement>("[data-ability-search]")!.value="";}
            else {const original=project.texts.banks.abilities?.[selected]??"";await configureAbilityRuleSets(project,[{abilityId:selected,name:name===displayAbilityName(selected,original)?undefined:name,description,rules:rule}]);}
            customDraft=false;onChange();
        },
    };
    root.innerHTML=`<div class="ability-editor-layout"><aside class="pokemon-filter ability-sidebar"><h2>Abilities</h2><button type="button" class="btn -default" data-add-ability>Add ability</button>${renderAbilityRuntimeUpdate(project)}<input type="search" data-ability-search placeholder="Search abilities" aria-label="Search abilities"><div class="ability-filters" role="group" aria-label="Show abilities" data-ability-filters></div><div class="ability-list" data-ability-list></div></aside><main class="pokemon-list ability-page" data-ability-panel></main><aside class="ability-reference" aria-label="Ability primitive reference" data-ability-reference></aside></div>`;
    const updateReference=installAbilityPrimitiveReference(root.querySelector<HTMLElement>("[data-ability-reference]")!,project);
    function list(){
        const names=(project.texts.banks.abilities??[]).map((name,id)=>displayAbilityName(id,name));
        const counts:Record<AbilityFilter,number>={all:0,new:0,edited:0};
        for(const change of changes.values())++counts[change.added?"new":"edited"];
        root.querySelector<HTMLElement>("[data-ability-filters]")!.innerHTML=(["all","new","edited"] as const).map(f=>`<button type="button" class="btn sm" data-ability-filter="${f}" aria-pressed="${filter===f}">${FILTER_LABELS[f]}${f==="all"?"":` <span class="ability-filter-count">${counts[f]}</span>`}</button>`).join("");
        const rows=names.slice(1,256).flatMap((name,index)=>{
            const id=index+1,change=changes.get(id);
            if(!name||!`${id} ${name}`.toLowerCase().includes(query.toLowerCase()))return [];
            if(filter==="new"&&!change?.added||filter==="edited"&&(!change||change.added))return [];
            const mark=change?`<i class="ability-list-mark ${change.added?"-new":"-edited"}" aria-hidden="true"></i><b class="ability-sr">, ${change.added?"new":"edited"}</b>`:"";
            return [`<button type="button" class="ability-list-item ${!adding&&selected===id?"-active":""}" data-ability-id="${id}"${change?` title="${escapeHtml(changeSummary(change))}"`:""}><span>${id}</span>${escapeHtml(name)}${mark}</button>`];
        });
        const empty=query.trim()?`No ${filter==="all"?"":`${FILTER_LABELS[filter].toLowerCase()} `}abilities match “${escapeHtml(query.trim())}”.`:filter==="new"?"No abilities added yet.":filter==="edited"?"No abilities differ from the original game.":"No abilities.";
        root.querySelector<HTMLElement>("[data-ability-list]")!.innerHTML=rows.join("")||`<p class="ability-list-empty">${empty}</p>`;
        root.querySelector<HTMLButtonElement>("[data-add-ability]")!.disabled=nextCustomAbilityId(project)===undefined||!editable;
    }
    function refreshChanges(){changes=abilityChanges(project,customRules);}
    function panel(){
        descriptionPreview?.destroy();
        refreshAbilityRuntimeUpdate(root,project);
        const state=inspectAbilityEffects(project);
        editable=state.editable;customRules=state.rules;refreshChanges();
        list();
        const name=adding?"":displayAbilityName(selected,project.texts.banks.abilities?.[selected]??`Ability ${selected}`),rule=adding?undefined:state.rules.get(selected);
        updateReference(new Map([...state.rules].map(([id,rule])=>[id,optimizeAbilityRule(rule)])));
        const native:AbilityRuleSet|undefined=!adding&&nativeAbilityProfile(`nativeAbility:${selected}`)?{effects:[{kind:`nativeAbility:${selected}`,value:-1}],conditions:EMPTY_ABILITY_RULE.conditions}:undefined;
        const noTemplate=!adding&&!rule&&!native&&!customDraft;
        const target=root.querySelector<HTMLElement>("[data-ability-panel]")!;
        let description=adding?newDescription:"",descriptionError="";
        if(!adding)try{description=getAbilityDescription(project,selected);}catch(error){descriptionError=error instanceof Error?error.message:String(error);}
        target.innerHTML=`<div class="ability-page-heading"><h2>${adding?"New ability":escapeHtml(name)} <small>#${selected}</small></h2><span class="ability-state">${!state.editable?"Unavailable":adding||customDraft?"Custom draft":rule?"Custom effects · Shared DLL":noTemplate?"No native template":"Native behavior"}</span></div>
          <label class="ability-name">Name<input data-ability-name aria-label="Ability name" maxlength="15" value="${escapeHtml(name)}" ${state.editable?"":"disabled"}></label>
          <section class="ability-description-editor"><label>Description<textarea data-ability-description aria-label="Ability description" spellcheck="false" ${descriptionError?"disabled":""}>${escapeHtml(description)}</textarea></label>${descriptionError?"":descriptionPreviewMarkup}<p role="status" data-ability-description-status>${escapeHtml(descriptionError)}</p></section>
          ${state.editable?noTemplate?`<button type="button" class="btn -default" data-ability-custom-draft>Create custom effects</button>`:`<div data-ability-rules>${renderItemRuleForm(project,{...optimizeAbilityRule(adding||customDraft?BLANK_ABILITY_DRAFT:rule??native??BLANK_ABILITY_DRAFT),consumable:false},options)}</div>${rule?`<button type="button" class="btn -default ${selected>164?"-remove":""}" data-ability-restore>${selected<=164?"Restore native behavior":"Remove custom effects"}</button>`:""}${adding?`<button type="button" class="btn -default" data-ability-cancel>Cancel</button>`:""}`:`<p role="status">${escapeHtml(state.message)}</p>`}`;
        const descriptionField=target.querySelector<HTMLTextAreaElement>("[data-ability-description]")!;
        const descriptionDetails=target.querySelector<HTMLDetailsElement>("[data-description-preview]");
        const preview=descriptionDetails?installLazyDescriptionPreview(project,descriptionDetails,"ability",()=>descriptionField.value,()=>{const value=target.querySelector<HTMLInputElement>("[data-ability-name]")!.value;return adding||value!==name?value:getAbilitySummaryName(project,selected);}):undefined;
        descriptionPreview=preview;
        descriptionField.addEventListener("input",()=>{if(adding)newDescription=descriptionField.value;preview?.refresh();});
        descriptionField.addEventListener("change",()=>{
            if(adding)return;
            const status=target.querySelector<HTMLElement>("[data-ability-description-status]")!;
            try{updateAbilityDescription(project,selected,descriptionField.value);descriptionField.classList.remove("invalid");status.textContent="";onChange();refreshChanges();list();}
            catch(error){descriptionField.classList.add("invalid");status.textContent=error instanceof Error?error.message:String(error);}
        });
        target.querySelector<HTMLInputElement>("[data-ability-name]")!.addEventListener("input",()=>preview?.refresh());
        target.querySelector<HTMLButtonElement>("[data-ability-custom-draft]")?.addEventListener("click",()=>{customDraft=true;panel();});
        const form=target.querySelector<HTMLElement>("[data-ability-rules]");
        if(form)installItemRuleEditor(form,project,selected,panel,()=>{},options);
        target.querySelector<HTMLButtonElement>("[data-ability-cancel]")?.addEventListener("click",()=>{adding=false;selected=previous;customDraft=false;panel();});
        target.querySelector<HTMLButtonElement>("[data-ability-restore]")?.addEventListener("click",()=>{try{clearAbilityRules(project,selected);customDraft=selected>164;onChange();panel();}catch(e){target.querySelector<HTMLElement>(".ability-state")!.textContent=String(e);}});
    }
    root.querySelector<HTMLButtonElement>("[data-add-ability]")!.addEventListener("click",()=>{const id=nextCustomAbilityId(project);if(id===undefined)return;previous=adding?previous:selected;selected=id;adding=true;customDraft=false;newDescription="";panel();root.querySelector<HTMLInputElement>("[data-ability-name]")!.focus();});
    root.querySelector<HTMLInputElement>("[data-ability-search]")!.addEventListener("input",event=>{query=(event.target as HTMLInputElement).value;list();});
    root.querySelector<HTMLElement>("[data-ability-filters]")!.addEventListener("click",event=>{const button=(event.target as HTMLElement).closest<HTMLElement>("[data-ability-filter]");if(button){filter=button.dataset.abilityFilter as AbilityFilter;list();}});
    root.querySelector<HTMLElement>("[data-ability-list]")!.addEventListener("click",event=>{const row=(event.target as HTMLElement).closest<HTMLElement>("[data-ability-id]");if(row){selected=Number(row.dataset.abilityId);adding=false;customDraft=false;panel();}});
    installAbilityRuntimeUpdate(root,project,onChange);
    panel();
}

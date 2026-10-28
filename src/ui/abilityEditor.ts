import { nativeAbilityProfile } from "../pokeweb/abilityNativeRuntime";
import { ABILITY_IMPORT_LIBRARY, abilityImport } from "../pokeweb/abilityLibrary";
import type { ProjectState } from "../pokeweb/projectStore";
import { inspectAbilityEffects, configureAbilityRuleSets, createCustomAbility, nextCustomAbilityId, clearAbilityRules } from "../pokeweb/abilityEffectsModel";
import { ABILITY_NATIVE_EFFECTS, ABILITY_RULE_EFFECTS, ABILITY_RULE_PRESETS, EMPTY_ABILITY_RULE, type AbilityRuleSet } from "../pokeweb/abilityRules";
import { renderItemRuleForm, installItemRuleEditor, type RuleFormOptions } from "./itemRuleEditor";
import { escapeHtml } from "./dom";

export const BLANK_ABILITY_DRAFT:AbilityRuleSet={effects:[],conditions:{kind:"group",mode:"all",children:[]}};
export function renderAbilityEditor(project: ProjectState, root: HTMLElement, onChange: () => void): void {
    let selected=1,previous=1,query="",customDraft=false,adding=false;
    const options:RuleFormOptions={
        ability:true,
        definitions:[...ABILITY_RULE_EFFECTS,...ABILITY_NATIVE_EFFECTS.map(d=>({...d,label:project.texts.banks.abilities?.[d.nativeItem]??d.label}))],
        presets:[...ABILITY_IMPORT_LIBRARY.map(p=>({id:p.id,label:p.label,group:`Generation ${p.generation}`})),...ABILITY_RULE_PRESETS.map(p=>({id:p.id,label:p.label,group:"BW2 templates"}))],
        preset:id=>({...structuredClone(id>164?abilityImport(id).rule:ABILITY_RULE_PRESETS.find(p=>p.id===id)!.rule),consumable:false}),
        imported:id=>{const name=root.querySelector<HTMLInputElement>("[data-ability-name]")!;if(!name.value.trim())name.value=id>164?abilityImport(id).defaultName:(ABILITY_RULE_PRESETS.find(p=>p.id===id)!.label).slice(0,15);},
        apply:async rule=>{
            const name=root.querySelector<HTMLInputElement>("[data-ability-name]")!.value;
            if(adding){selected=await createCustomAbility(project,name,rule);adding=false;query="";root.querySelector<HTMLInputElement>("[data-ability-search]")!.value="";}
            else await configureAbilityRuleSets(project,[{abilityId:selected,name,rules:rule}]);
            customDraft=false;onChange();
        },
    };
    root.innerHTML=`<aside class="pokemon-filter ability-sidebar"><h2>Abilities</h2><button type="button" class="btn -default" data-add-ability>Add ability</button><input type="search" data-ability-search placeholder="Search abilities" aria-label="Search abilities"><div class="ability-list" data-ability-list></div></aside><main class="pokemon-list ability-page" data-ability-panel></main>`;
    function list(){
        const names=project.texts.banks.abilities??[];
        root.querySelector<HTMLElement>("[data-ability-list]")!.innerHTML=names.slice(1,256).flatMap((name,index)=>name&&`${index+1} ${name}`.toLowerCase().includes(query.toLowerCase())?[`<button type="button" class="ability-list-item ${!adding&&selected===index+1?"-active":""}" data-ability-id="${index+1}"><span>${index+1}</span>${escapeHtml(name)}</button>`]:[]).join("");
        root.querySelector<HTMLButtonElement>("[data-add-ability]")!.disabled=nextCustomAbilityId(project)===undefined||!inspectAbilityEffects(project).editable;
    }
    function panel(){
        list();
        const state=inspectAbilityEffects(project),name=adding?"":project.texts.banks.abilities?.[selected]??`Ability ${selected}`,rule=adding?undefined:state.rules.get(selected);
        const native:AbilityRuleSet|undefined=!adding&&nativeAbilityProfile(`nativeAbility:${selected}`)?{effects:[{kind:`nativeAbility:${selected}`,value:-1}],conditions:EMPTY_ABILITY_RULE.conditions}:undefined;
        const noTemplate=!adding&&!rule&&!native&&!customDraft;
        const target=root.querySelector<HTMLElement>("[data-ability-panel]")!;
        target.innerHTML=`<div class="ability-page-heading"><h2>${adding?"New ability":escapeHtml(name)} <small>#${selected}</small></h2><span class="ability-state">${!state.editable?"Unavailable":adding||customDraft?"Custom draft":rule?"Custom effects · Shared DLL":noTemplate?"No native template":"Native behavior"}</span></div>
          <label class="ability-name">Name<input data-ability-name aria-label="Ability name" maxlength="15" value="${escapeHtml(name)}" ${state.editable?"":"disabled"}></label>
          ${state.editable?noTemplate?`<button type="button" class="btn -default" data-ability-custom-draft>Create custom effects</button>`:`<div data-ability-rules>${renderItemRuleForm(project,{...structuredClone(adding||customDraft?BLANK_ABILITY_DRAFT:rule??native??BLANK_ABILITY_DRAFT),consumable:false},options)}</div>${rule?`<button type="button" class="btn -default" data-ability-restore>${selected<=164?"Restore native behavior":"Remove custom effects"}</button>`:""}${adding?`<button type="button" class="btn -default" data-ability-cancel>Cancel</button>`:""}`:`<p role="status">${escapeHtml(state.message)}</p>`}`;
        target.querySelector<HTMLButtonElement>("[data-ability-custom-draft]")?.addEventListener("click",()=>{customDraft=true;panel();});
        const form=target.querySelector<HTMLElement>("[data-ability-rules]");
        if(form)installItemRuleEditor(form,project,selected,panel,()=>{},options);
        target.querySelector<HTMLButtonElement>("[data-ability-cancel]")?.addEventListener("click",()=>{adding=false;selected=previous;customDraft=false;panel();});
        target.querySelector<HTMLButtonElement>("[data-ability-restore]")?.addEventListener("click",()=>{try{clearAbilityRules(project,selected);customDraft=selected>164;onChange();panel();}catch(e){target.querySelector<HTMLElement>(".ability-state")!.textContent=String(e);}});
    }
    root.querySelector<HTMLButtonElement>("[data-add-ability]")!.addEventListener("click",()=>{const id=nextCustomAbilityId(project);if(id===undefined)return;previous=adding?previous:selected;selected=id;adding=true;customDraft=false;panel();root.querySelector<HTMLInputElement>("[data-ability-name]")!.focus();});
    root.querySelector<HTMLInputElement>("[data-ability-search]")!.addEventListener("input",event=>{query=(event.target as HTMLInputElement).value;list();});
    root.querySelector<HTMLElement>("[data-ability-list]")!.addEventListener("click",event=>{const row=(event.target as HTMLElement).closest<HTMLElement>("[data-ability-id]");if(row){selected=Number(row.dataset.abilityId);adding=false;customDraft=false;panel();}});
    panel();
}

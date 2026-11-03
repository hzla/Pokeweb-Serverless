import {getPmcMemoryEstimate,type PmcMemoryEstimate} from "../pokeweb/pmcMemoryModel";
import type {ProjectState} from "../pokeweb/projectStore";
import {escapeHtml} from "./dom";

export const formatPmcKiB=(bytes:number)=>`${(bytes/1024).toFixed(1)} KiB`;
export function renderPmcCapacity(estimate:PmcMemoryEstimate,bw1=false):string {
  const bars=([['battle','Battle'],['overworld','Overworld']]as const).map(([key,label])=>{
    const phase=estimate[key],percent=Math.min(100,phase.residentBytes/estimate.capBytes*100),peak=Math.min(100,phase.loadingPeakBytes/estimate.capBytes*100);
    const state=phase.loadingPeakBytes>estimate.capBytes?"-over":phase.loadingPeakBytes>estimate.capBytes*.85?"-near":"";
    return `<div class="pmc-capacity-phase ${state}"><div class="pmc-capacity-label"><strong>${label}</strong><span>${formatPmcKiB(phase.residentBytes)}</span></div><div class="pmc-capacity-track" role="meter" aria-label="Estimated ${label.toLowerCase()} PMC heap usage" aria-valuemin="0" aria-valuemax="${estimate.capBytes}" aria-valuenow="${Math.min(phase.residentBytes,estimate.capBytes)}" aria-valuetext="${formatPmcKiB(phase.residentBytes)} retained; ${formatPmcKiB(phase.loadingPeakBytes)} loading peak; ${formatPmcKiB(estimate.capBytes)} cap"><span class="pmc-capacity-peak" style="width:${peak}%"></span><span class="pmc-capacity-used" style="width:${percent}%"></span></div><small>Loading peak ${formatPmcKiB(phase.loadingPeakBytes)}</small></div>`;
  }).join("");
  return `<section class="pmc-capacity" aria-label="Estimated PMC heap capacity"><div class="pmc-capacity-label"><h3>Estimated heap use</h3><span>${estimate.capBytes/1024} KiB cap</span></div>${bars}<small class="pmc-capacity-note">Both phases share one heap. ${bw1?"BW1 can allocate less than this cap. ":"Actual capacity may be lower. "}Excludes extra memory allocated by patches during play.</small>${estimate.conservative.length?`<small title="${escapeHtml(estimate.conservative.join(', '))}">Unclassified DLLs are included in both phases.</small>`:""}${estimate.unknown.length?`<small class="pmc-capacity-warning" title="${escapeHtml(estimate.unknown.map(path=>`${path}: ${estimate.issues[path]}`).join("; "))}">Incomplete estimate: ${estimate.unknown.length} unreadable DLL${estimate.unknown.length===1?"":"s"}.</small>`:""}</section>`;
}

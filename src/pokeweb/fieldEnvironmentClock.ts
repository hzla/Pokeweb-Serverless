import type {SceneEnvironment} from './cutsceneEnvironment';

export const FIELD_SEASONS=['spring','summer','autumn','winter'] as const;
export type FieldEnvironment = SceneEnvironment & {
  sourceSeason:typeof FIELD_SEASONS[number];retainSeason:true;
  seasonCycles?:number;
  tempo?:{accelerateFraction:number;decelerateFraction:number;boost?:{startFrame:number;durationFrames:number;multiplier:number}};
  persistSeason?:boolean;
};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const smooth=(n:number)=>{const t=clamp(n);return t*t*(3-2*t);};
// The integral of smoothstep, including its constant-rate tail.
const integral=(t:number)=>t<=0?0:t>=1?t-.5:t*t*t-.5*t*t*t*t;
function rateArea(e:FieldEnvironment,t:number){
  const a=e.tempo?.accelerateFraction??0,b=e.tempo?.decelerateFraction??0,peak=e.ambientSpeed??1;
  const ramp=a? a*integral(t/a):t;
  const brake=b? b*integral((t-(1-b))/b):0;
  const boost=e.tempo?.boost,begin=boost?(boost.startFrame-e.startFrame)/(e.endFrame-e.startFrame):0,length=boost?boost.durationFrames/(e.endFrame-e.startFrame):1;
  const boosted=boost?peak*(boost.multiplier-1)*(length*integral((t-begin)/length)-brake):0;
  return t+(peak-1)*(ramp-brake)+boosted;
}
export function fieldEnvironmentClock(e:FieldEnvironment,frame:number){
  const duration=e.endFrame-e.startFrame,u=clamp((frame-e.startFrame)/duration);
  const progress=e.tempo?rateArea(e,u)/rateArea(e,1):u;
  const boost=e.tempo?.boost,extra=boost?(e.ambientSpeed??1)*(boost.multiplier-1)*smooth((frame-boost.startFrame)/boost.durationFrames):0;
  const speed=frame<e.startFrame||frame>=e.endFrame?1:e.tempo?
    1+(((e.ambientSpeed??1)-1)*smooth(u/e.tempo.accelerateFraction)+extra)*smooth((1-u)/e.tempo.decelerateFraction):e.ambientSpeed??1;
  const from=FIELD_SEASONS.indexOf(e.sourceSeason),to=FIELD_SEASONS.indexOf(e.targetSeason);
  const steps=e.seasonCycles===undefined?1:e.seasonCycles*4+(to-from+4)%4;
  const at=progress*steps,segment=Math.min(Math.max(0,steps-1),Math.floor(at));
  const source=e.seasonCycles===undefined?from:(from+segment)%4,target=e.seasonCycles===undefined?to:(source+1)%4;
  const blend=smooth(at-segment),phase=(progress*e.dayCycles)%1;
  const stops=[[1,1,1],[1,.64,.45],[.24,.32,.58],[.87,.64,.76],[1,1,1]],i=Math.min(3,Math.floor(phase*4)),t=smooth(phase*4-i);
  const tint=stops[i].map((v,c)=>Math.round((v+(stops[i+1][c]-v)*t)*31)/31);
  const before=Math.min(frame,e.startFrame),inside=duration*rateArea(e,u),after=Math.max(0,frame-e.endFrame);
  return {progress,speed,source,target,blend,level:Math.round(blend*31),tint,ambientFrame:Math.max(0,before)+inside+after};
}

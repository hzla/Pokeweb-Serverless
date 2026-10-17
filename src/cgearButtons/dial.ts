import geometry from "./dial.json";
export const dial = geometry;
export type DialPoint = {x:number;y:number};
export function onDial(p:DialPoint):boolean {
  const d=(p.x-dial.centerX)**2+(p.y-dial.centerY)**2;
  return d>=dial.innerRadius**2&&d<=dial.outerRadius**2;
}
/** Integer centidegrees, clockwise in screen coordinates, matching the DS adapter. */
export function dialAngle(p:DialPoint):number {
  const x=Math.trunc(p.x)-dial.centerX,y=Math.trunc(p.y)-dial.centerY,ax=Math.abs(x),ay=Math.abs(y);
  if(!ax&&!ay)return 0;
  const lo=Math.min(ax,ay),hi=Math.max(ax,ay),a=dial.atan[Math.floor((lo*128+Math.floor(hi/2))/hi)];
  const first=ax>=ay?a:9000-a;
  return y>=0?(x>=0?first:18000-first):(x<0?18000+first:(36000-first)%36000);
}
export function dialMarker(p:DialPoint):DialPoint {
  const x=Math.trunc(p.x)-dial.centerX,y=Math.trunc(p.y)-dial.centerY,r=Math.floor(Math.sqrt(x*x+y*y))||1;
  return {x:dial.centerX+Math.trunc(x*dial.markerRadius/r),y:dial.centerY+Math.trunc(y*dial.markerRadius/r)};
}
export function dialDelta(previous:number,next:number):number {let d=next-previous;if(d>18000)d-=36000;if(d< -18000)d+=36000;return d;}
export function advanceDial(previous:number,accumulated:number,p:DialPoint){
  const angle=dialAngle(p),delta=dialDelta(previous,angle);
  if((p.x-dial.centerX)**2+(p.y-dial.centerY)**2<80**2||Math.abs(delta)>9000)return {angle,accumulated,steps:0};
  accumulated+=delta;const steps=Math.trunc(accumulated/dial.step)||0;
  return {angle,accumulated:accumulated-steps*dial.step,steps};
}

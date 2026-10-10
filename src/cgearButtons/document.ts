import { defaultSkins } from "./skins";
export const MAX_BUTTONS = 8;
export type ActionId = "repel" | "pc" | "bike" | "mapFly" | "map" | "dowsing" | "rod" | "recorder" | "palPad" | "xtransceiver" | "medals" | "gracidea" | "splicers" | "revealGlass" | "bag" | "party";
export type Button = { id: number; label: string; color: string; x: number; y: number; action: ActionId; flag?: { id: number; when: "set" | "clear" } };
export type Skin = { id: number; name: string; data: string };
export type SkinCollection = { nextId: number; defaultId: number; entries: Skin[] };
export type Document = { version: 1; nextId: number; buttons: Button[]; hideCommunicationButtons?: boolean; skins?: SkinCollection };
export type Project = { document: Document; applied?: Document; enabled: boolean };
export type Action = { id: ActionId; code: number; name: string; label: string; item: number; alternate?: number; group?: number; check: number; kind: "toggle" | "field" | "application" | "script"; call?: number; event?: number };
export const actions: readonly Action[] = [
  { id:"repel", code:1, name:"Unlimited Repel — toggle", label:"REPEL", item:0, check:255, kind:"toggle" },
  { id:"pc", code:2, name:"PC — Pokémon storage", label:"PC", item:0, check:255, kind:"script" },
  { id:"bike", code:3, name:"Bicycle — toggle riding", label:"BIKE", item:450, group:4, check:0, kind:"field", event:0 },
  { id:"mapFly", code:4, name:"Town Map / eligible Fly", label:"MAP", item:442, group:2, check:1, kind:"application", call:8 },
  { id:"map", code:5, name:"Town Map — ordinary map", label:"MAP", item:442, group:2, check:1, kind:"application", call:8 },
  { id:"dowsing", code:6, name:"Dowsing Machine", label:"FIND", item:471, group:25, check:9, kind:"field", event:5 },
  { id:"rod", code:7, name:"Super Rod — fish", label:"ROD", item:447, group:18, check:5, kind:"field", event:4 },
  { id:"recorder", code:8, name:"Vs. Recorder", label:"VS", item:465, group:23, check:6, kind:"application", call:12 },
  { id:"palPad", code:9, name:"Pal Pad", label:"PAL", item:437, group:10, check:7, kind:"application", call:9 },
  { id:"xtransceiver", code:10, name:"Xtransceiver", label:"CALL", item:621, alternate:626, group:26, check:10, kind:"application", call:13 },
  { id:"medals", code:11, name:"Medal Box", label:"MEDAL", item:627, group:27, check:11, kind:"application", call:14 },
  { id:"gracidea", code:12, name:"Gracidea — select Pokémon", label:"FORM", item:466, group:24, check:255, kind:"application", call:0 },
  { id:"splicers", code:13, name:"DNA Splicers — fuse / separate", label:"FUSE", item:628, alternate:629, group:28, check:255, kind:"application", call:0 },
  { id:"revealGlass", code:14, name:"Reveal Glass — select Pokémon", label:"FORM", item:638, group:30, check:255, kind:"application", call:0 },
  { id:"bag", code:15, name:"Bag — native item menu", label:"BAG", item:0, check:255, kind:"application", call:2 },
  { id:"party", code:16, name:"Party — native Pokémon menu", label:"PARTY", item:0, check:255, kind:"application", call:0 },
];
export const actionFor = (id: string) => actions.find(a => a.id === id);
export const colors = ["#18d878", "#f87800", "#d830f8", "#c068f0", "#00c8d8", "#f8d840", "#f86078", "#b8e0f8"];
export function defaults(): Document {
  return { version:1, nextId:7, hideCommunicationButtons:true, skins:defaultSkins(), buttons:[
    {id:1,label:"REPEL",color:colors[0],x:60,y:116,action:"repel"},
    {id:2,label:"PC",color:"#ff637b",x:68,y:60,action:"pc",flag:{id:1517,when:"clear"}},
    {id:3,label:"BIKE",color:colors[2],x:88,y:152,action:"bike"},
    {id:4,label:"MAP",color:colors[3],x:172,y:152,action:"mapFly"},
    {id:5,label:"PARTY",color:"#29c5f7",x:188,y:60,action:"party"},
    {id:6,label:"BAG",color:colors[1],x:196,y:116,action:"bag"},
  ] };
}
/** Exact preset for metadata-free installations made before the editor. */
export function legacyDefaults(): Document {
  const doc=defaults();doc.buttons=doc.buttons.slice(0,4);doc.nextId=5;delete doc.hideCommunicationButtons;
  Object.assign(doc.buttons[1],{color:colors[1],x:196,y:116});return doc;
}
export function newButton(doc: Document, action: ActionId = "dowsing"): Button {
  const id=doc.nextId++; if(id>65535) throw new Error("This design has exhausted its button IDs.");
  const points=[[64,88],[192,88],[48,152],[208,152],[96,88],[160,88],[32,112],[224,112]];
  const p=points.find(([x,y])=>doc.buttons.every(b=>(b.x-x)**2+(b.y-y)**2>=1024)) ?? points[0];
  return {id,label:actionFor(action)!.label,color:colors[doc.buttons.length%8],x:p[0],y:p[1],action};
}

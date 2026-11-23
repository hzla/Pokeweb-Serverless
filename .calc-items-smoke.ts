import {readFile} from "node:fs/promises";
import {loadProjectFromRomBytes} from "./src/pokeweb/loader";
import {getItemRecord} from "./src/pokeweb/moveItemModel";
const p=await loadProjectFromRomBytes(await readFile(process.argv[2]),"items.nds",{selectedNarcs:["items","message_texts"]});
for(const id of [222,233,237,238,239,240,241,242,243,244,245,246,247,248,249,250,251,254,266,267,268,270,298,299,311,314,315,317,318])console.log(id,getItemRecord(p,id).raw.gain_values)

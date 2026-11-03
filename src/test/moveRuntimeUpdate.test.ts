import {beforeEach,describe,expect,it,vi} from "vitest";
import type {ProjectState} from "../pokeweb/projectStore";
import type {MoveEffectsInspection} from "../pokeweb/moveEffectsModel";
import {renderMoveRuntimeUpdate,installMoveRuntimeUpdate,refreshMoveRuntimeUpdate} from "../ui/moveRuntimeUpdate";
const mock=vi.hoisted(()=>({state:{editable:true,rules:new Map(),message:"",runtimeVersion:11,packagingVersion:1,updateAvailable:true} as MoveEffectsInspection,upgrade:vi.fn()}));
vi.mock("../pokeweb/moveEffectsModel",()=>({inspectMoveEffects:()=>mock.state,upgradeMoveRuntime:mock.upgrade}));
const project={}as ProjectState;
function fixture(){
  let listener:(()=>Promise<void>)|undefined;
  const button={disabled:false,title:"",addEventListener:(_type:string,handler:()=>Promise<void>)=>{listener=handler;}},status={textContent:""};
  const root={querySelector:(selector:string)=>selector==="[data-update-move-runtime]"?button:status}as unknown as HTMLElement;
  return {root,button,status,click:()=>listener!()};
}
describe("move runtime update button",()=>{
  beforeEach(()=>{mock.state={editable:true,rules:new Map(),message:"",runtimeVersion:11,packagingVersion:1,updateAvailable:true};mock.upgrade.mockReset();});
  it("enables older packages even when their interpreter version is unchanged",()=>{
    const html=renderMoveRuntimeUpdate(project);
    expect(html).toContain("Update Move Runtime");expect(html).toContain("Latest Version pushed at");
    expect(html).not.toMatch(/data-update-move-runtime\s+disabled/u);
  });
  it("disables absent, current and unrecognized runtimes with a reason",()=>{
    for(const state of [
      {...mock.state,runtimeVersion:undefined,updateAvailable:false},
      {...mock.state,packagingVersion:2,updateAvailable:false},
      {...mock.state,editable:false,message:"Unrecognized <code>",updateAvailable:false},
    ]){mock.state=state;expect(renderMoveRuntimeUpdate(project)).toMatch(/data-update-move-runtime\s+disabled/u);}
    expect(renderMoveRuntimeUpdate(project)).toContain("Unrecognized &lt;code&gt;");
  });
  it("updates once, marks the project dirty and disables the completed button",async()=>{
    const f=fixture(),dirty=vi.fn();mock.upgrade.mockImplementation(async()=>{mock.state={...mock.state,packagingVersion:2,updateAvailable:false};return true;});
    installMoveRuntimeUpdate(f.root,project,dirty);await f.click();
    expect(mock.upgrade).toHaveBeenCalledOnce();expect(mock.upgrade).toHaveBeenCalledWith(project);expect(dirty).toHaveBeenCalledOnce();expect(f.status.textContent).toBe("Updated");expect(f.button.disabled).toBe(true);expect(f.button.title).toBe("Move runtime is current");
  });
  it("reports failure without dirtying and leaves a recognized older runtime retryable",async()=>{
    const f=fixture(),dirty=vi.fn();mock.upgrade.mockRejectedValue(new Error("Conflicting move hook"));
    installMoveRuntimeUpdate(f.root,project,dirty);await f.click();
    expect(f.status.textContent).toBe("Conflicting move hook");expect(dirty).not.toHaveBeenCalled();expect(f.button.disabled).toBe(false);
  });
  it("refreshes after another editor applies the upgrade",()=>{
    const f=fixture();mock.state={...mock.state,updateAvailable:false};refreshMoveRuntimeUpdate(f.root,project);expect(f.button.disabled).toBe(true);
  });
});

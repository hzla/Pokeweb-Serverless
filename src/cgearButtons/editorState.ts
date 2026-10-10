import type { Document } from "./document";
/** Selection and history never enter ROM metadata. */
export class EditorHistory {
  private undoStack:Document[]=[];private redoStack:Document[]=[];
  constructor(public document:Document){}
  get canUndo(){return this.undoStack.length>0;}get canRedo(){return this.redoStack.length>0;}
  commit(next:Document,before=this.document){if(JSON.stringify(before)===JSON.stringify(next))return false;this.undoStack.push(structuredClone(before));if(this.undoStack.length>100)this.undoStack.shift();this.redoStack=[];this.document=next;return true;}
  undo(){const prior=this.undoStack.pop();if(prior){this.redoStack.push(structuredClone(this.document));this.document=prior;}return this.document;}
  redo(){const next=this.redoStack.pop();if(next){this.undoStack.push(structuredClone(this.document));this.document=next;}return this.document;}
}

VM_Read16 = 0x020159e9;
FieldScriptEnv_GetScriptWork = 0x021551c5;
ScriptWork_GetFieldWork = 0x02153ee9;
BmpWin_CreateDynamic = 0x020480ed;
BmpWin_GetBitmap = 0x02048521;
GFL_BitmapCreate = 0x02046e55;
GFL_BitmapFree = 0x02046f09;
GFL_BitmapGetPixelData = 0x02046f21;
BmpWin_FlushChar = 0x02048271;
TalkWindow_DrawNormalFrame = 0x0218b5ed;
TalkWindow_FreeSlot = 0x0218b4f5;
GX_LoadBGPltt = 0x020754e5;
GX_LoadOBJPltt = 0x020755cd;
Field_GetHeapID = 0x02180501;
GFL_ArcSysCreateMemoryHandle = 0x0204aa8d;
GFL_ArcToolFree = 0x0204ab39;
ClActSys_LoadPltt = 0x0204bbcd;
ClActSys_FreePltt = 0x0204bcfd;
ClActUnit_Create = 0x0204bf49;
ClActUnit_Delete = 0x0204bfc5;
BmpOam_Init = 0x0202ae89;
BmpOam_Exit = 0x0202aed9;
BmpOam_ActorAdd = 0x0202aef1;
BmpOam_ActorDel = 0x0202b05d;
BmpOam_ActorSetDrawEnable = 0x0202b0c5;
BmpOam_ActorBmpTrans = 0x0202b121;

GFL_ArcSysCreateFileHandle = 0x0204aa5d;
ClActSys_LoadChars = 0x0204b849;
ClActSys_GetCharVramAddr = 0x0204bbad;
ClActSys_FreeChars = 0x0204b9b9;
ClActSys_LoadCellAnims = 0x0204be0d;
ClActSys_FreeCellAnims = 0x0204be91;
ClActor_Create = 0x0204c06d;
ClActor_Delete = 0x0204c135;
ClActor_SetFlip = 0x0204c2dd;
GX_GetBankForOBJExtPltt = 0x02076f25;
GX_GetBankForLCDC = 0x02076f3d;
GX_SetBankForOBJExtPltt = 0x02076821;
GX_ResetBankForOBJExtPltt = 0x02076cad;
GX_DisableBankForOBJExtPltt = 0x02076e49;

SECTIONS {
    . = 0x021e5c90;
    .text : { *(.text*) *(.rodata*) }
    . = ALIGN(4);
    .data : { *(.data*) }
    /DISCARD/ : { *(.comment*) *(.ARM.attributes*) *(.ARM.exidx*) }
}

.thumb

.type THUMB_BRANCH_LINK_298_0x21A8EBA, %function
.type THUMB_BRANCH_LINK_298_0x21A8ECA, %function
.type THUMB_BRANCH_LINK_298_0x21A8624, %function
.type THUMB_BRANCH_LINK_298_0x21A8F08, %function
.type THUMB_BRANCH_LINK_284_0x21E5324, %function
.type THUMB_BRANCH_LINK_284_0x21E536E, %function
.type THUMB_BRANCH_LINK_284_0x21E5170, %function
.type THUMB_BRANCH_LINK_284_0x21E5176, %function
.type THUMB_BRANCH_LINK_284_0x21E5192, %function
.type THUMB_BRANCH_LINK_284_0x21E5198, %function
.type THUMB_BRANCH_LINK_284_0x21E53B0, %function
.type THUMB_BRANCH_LINK_284_0x21E3D6E, %function
.type THUMB_BRANCH_LINK_307_0x21DE000, %function
.type THUMB_BRANCH_LINK_307_0x21DEF14, %function
.type THUMB_BRANCH_LINK_307_0x21DEE3A, %function
.type THUMB_BRANCH_LINK_307_0x21DEE46, %function
.type THUMB_BRANCH_LINK_307_0x21DF0CA, %function
.type THUMB_BRANCH_LINK_265_0x219A116, %function
.type THUMB_BRANCH_LINK_265_0x219A126, %function
.type THUMB_BRANCH_LINK_265_0x2199EBC, %function
.type THUMB_BRANCH_LINK_265_0x219A154, %function

.extern W2U_NonBattle_BuildSpriteParams
.extern W2U_NonBattle_BuildSpriteParamsFromPp
.extern W2U_NonBattle_Add
.extern W2U_NonBattle_AddPokeMcss
.extern W2U_NonBattle_Draw
.extern W2U_NonBattle_Del
.extern W2U_Evolution_AddPokeMcssLoop
.extern W2U_Evolution_AddPokeMcssSingle
.extern W2U_Evolution_MainMcss
.extern W2U_Evolution_MainIndependent
.extern W2U_Evolution_DrawMcss
.extern W2U_Evolution_DrawIndependent
.extern W2U_Evolution_AfterGraphicEnd
.extern W2U_Evolution_Del
.extern W2U_EggHatch_AddPokeMcss
.extern W2U_EggHatch_Draw
.extern W2U_EggHatch_AfterObjMain
.extern W2U_EggHatch_AfterFrameTail
.extern W2U_EggHatch_Del

.macro B2_TAIL_HOOK name, target
\name:
    push {r0}
    ldr r0, =\target
    mov r12, r0
    pop {r0}
    bx r12
    .size \name, . - \name
.endm

B2_TAIL_HOOK THUMB_BRANCH_LINK_298_0x21A8EBA, W2U_NonBattle_BuildSpriteParams
B2_TAIL_HOOK THUMB_BRANCH_LINK_298_0x21A8ECA, W2U_NonBattle_Add
B2_TAIL_HOOK THUMB_BRANCH_LINK_298_0x21A8624, W2U_NonBattle_Draw
B2_TAIL_HOOK THUMB_BRANCH_LINK_298_0x21A8F08, W2U_NonBattle_Del

B2_TAIL_HOOK THUMB_BRANCH_LINK_284_0x21E5324, W2U_Evolution_AddPokeMcssLoop
B2_TAIL_HOOK THUMB_BRANCH_LINK_284_0x21E536E, W2U_Evolution_AddPokeMcssSingle
B2_TAIL_HOOK THUMB_BRANCH_LINK_284_0x21E5170, W2U_Evolution_MainMcss
B2_TAIL_HOOK THUMB_BRANCH_LINK_284_0x21E5176, W2U_Evolution_MainIndependent
B2_TAIL_HOOK THUMB_BRANCH_LINK_284_0x21E5192, W2U_Evolution_DrawMcss
B2_TAIL_HOOK THUMB_BRANCH_LINK_284_0x21E5198, W2U_Evolution_DrawIndependent
B2_TAIL_HOOK THUMB_BRANCH_LINK_284_0x21E53B0, W2U_Evolution_Del
B2_TAIL_HOOK THUMB_BRANCH_LINK_284_0x21E3D6E, W2U_Evolution_AfterGraphicEnd

B2_TAIL_HOOK THUMB_BRANCH_LINK_307_0x21DE000, W2U_EggHatch_AfterFrameTail
B2_TAIL_HOOK THUMB_BRANCH_LINK_307_0x21DEF14, W2U_EggHatch_AddPokeMcss
B2_TAIL_HOOK THUMB_BRANCH_LINK_307_0x21DEE3A, W2U_EggHatch_Draw
B2_TAIL_HOOK THUMB_BRANCH_LINK_307_0x21DEE46, W2U_EggHatch_AfterObjMain
B2_TAIL_HOOK THUMB_BRANCH_LINK_307_0x21DF0CA, W2U_EggHatch_Del

B2_TAIL_HOOK THUMB_BRANCH_LINK_265_0x219A116, W2U_NonBattle_BuildSpriteParamsFromPp
B2_TAIL_HOOK THUMB_BRANCH_LINK_265_0x219A126, W2U_NonBattle_Add
B2_TAIL_HOOK THUMB_BRANCH_LINK_265_0x2199EBC, W2U_NonBattle_Draw
B2_TAIL_HOOK THUMB_BRANCH_LINK_265_0x219A154, W2U_NonBattle_Del

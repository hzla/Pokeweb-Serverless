#pragma once

// Version-specific executable and data anchors used by the shared W2U/B2U
// gameplay sources.  Keep the White 2 values literal so compiling without
// W2U_TARGET_B2 produces the historical White2Upgrade objects unchanged.
#if defined(W2U_TARGET_B2)

#define W2U_PATH_POKE_FORM_LIST                     "data/black2upgrade/poke_form_list.bin"
#define W2U_PATH_POKEICON_PALETTE_MAP               "data/black2upgrade/pokeicon_palette_map.bin"
#define W2U_PATH_TYPE_CHART                         "data/black2upgrade/type_chart.bin"
#define W2U_PATH_TYPE_PALETTE_MAP                   "data/black2upgrade/type_palette_map.bin"

#define W2U_ADDR_PERSONAL_ARC_BW2                    0x021413E8u
#define W2U_ADDR_ABILITY_EVENT_TABLE                 0x021D7EF8u
#define W2U_ADDR_ITEM_EVENT_TABLE                    0x021D8F28u
#define W2U_ADDR_MOVE_EVENT_TABLE                    0x021DA0B4u
#define W2U_ADDR_POS_EVENT_TABLE                     0x0689D850u
#define W2U_ADDR_POS_EVENT_CAN_REGISTER              0x068982C1u

#define W2U_ADDR_MEGA_NATIVE_CHECK_KEY               0x021EECBDu
#define W2U_ADDR_MEGA_INPUT_TABLE_NORMAL             0x021F3604u
#define W2U_ADDR_MEGA_INPUT_TABLE_TRIPLE             0x021F3610u
#define W2U_ADDR_GFL_UI_TP_HIT_TRG                   0x0203DA0Du
#define W2U_ADDR_CMD_ACT_WAIT                        0x021D3131u
#define W2U_ADDR_BATTLE_VIEW_RESOLVE_VIEW_MON        0x0219C745u
#define W2U_ADDR_BATTLE_VIEW_LOOKUP_MON              0x0219D189u
#define W2U_ADDR_BATTLE_VIEW_DEREF_MON               0x021BB045u
#define W2U_ADDR_BATTLE_VIEW_REFRESH_FORM_SPRITE     0x021DF76Du

#define W2U_ADDR_CLACT_UNIT_CREATE                   0x0204BF1Du
#define W2U_ADDR_CLACT_UNIT_DELETE                   0x0204BF99u
#define W2U_ADDR_CLACT_WORK_CREATE                   0x0204C041u
#define W2U_ADDR_CLACT_WORK_REMOVE                   0x0204C109u
#define W2U_ADDR_CLACT_WORK_SET_POS                  0x0204C141u
#define W2U_ADDR_CLACT_WORK_SET_AUTO_ANIMATION       0x0204C521u
#define W2U_ADDR_CLACT_WORK_SET_SEQUENCE             0x0204C489u

#define W2U_ADDR_FIELD_CAN_USE_ITEM_ON_MON           0x021A23E9u
#define W2U_ADDR_FIELD_MSG_CREATE_WORD_SET           0x0219F9D9u
#define W2U_ADDR_FIELD_MSG_ADD_POKE_NAME             0x0219F9F9u
#define W2U_ADDR_FIELD_MSG_DELETE_WORD_SET           0x0219F9E9u
#define W2U_ADDR_WORD_SET_REGISTER_ABILITY_NAME      0x02024501u
#define W2U_ADDR_FIELD_MESSAGE_WAIT_INIT             0x0219D74Du
#define W2U_ADDR_FIELD_YES_NO_WAIT_INIT              0x0219D7D5u
#define W2U_ADDR_FIELD_MSG_CLOSE_WINDOW              0x0219F7FDu
#define W2U_ADDR_FIELD_RETURN_AFTER_ITEM_USE         0x0219DE19u
#define W2U_ADDR_FIELD_PLATE_REDRAW_PARAM            0x0219F311u
#define W2U_ADDR_FIELD_SUB_BAG_ITEM                  0x0219E649u

#else

#define W2U_PATH_POKE_FORM_LIST                     "poke_form_list.bin"
#define W2U_PATH_POKEICON_PALETTE_MAP               "pokeicon_palette_map.bin"
#define W2U_PATH_TYPE_CHART                         "type_chart.bin"
#define W2U_PATH_TYPE_PALETTE_MAP                   "type_palette_map.bin"

#define W2U_ADDR_PERSONAL_ARC_BW2                    0x02141428u
#define W2U_ADDR_ABILITY_EVENT_TABLE                 0x021D7F38u
#define W2U_ADDR_ITEM_EVENT_TABLE                    0x021D8F68u
#define W2U_ADDR_MOVE_EVENT_TABLE                    0x021DA0F4u
#define W2U_ADDR_POS_EVENT_TABLE                     0x0689D850u
#define W2U_ADDR_POS_EVENT_CAN_REGISTER              0x068982C1u

#define W2U_ADDR_MEGA_NATIVE_CHECK_KEY               0x021EECFDu
#define W2U_ADDR_MEGA_INPUT_TABLE_NORMAL             0x021F3644u
#define W2U_ADDR_MEGA_INPUT_TABLE_TRIPLE             0x021F3650u
#define W2U_ADDR_GFL_UI_TP_HIT_TRG                   0x0203DA39u
#define W2U_ADDR_CMD_ACT_WAIT                        0x021D3171u
#define W2U_ADDR_BATTLE_VIEW_RESOLVE_VIEW_MON        0x0219C785u
#define W2U_ADDR_BATTLE_VIEW_LOOKUP_MON              0x0219D1C9u
#define W2U_ADDR_BATTLE_VIEW_DEREF_MON               0x021BB085u
#define W2U_ADDR_BATTLE_VIEW_REFRESH_FORM_SPRITE     0x021DF7ADu

#define W2U_ADDR_CLACT_UNIT_CREATE                   0x0204BF49u
#define W2U_ADDR_CLACT_UNIT_DELETE                   0x0204BFC5u
#define W2U_ADDR_CLACT_WORK_CREATE                   0x0204C06Du
#define W2U_ADDR_CLACT_WORK_REMOVE                   0x0204C135u
#define W2U_ADDR_CLACT_WORK_SET_POS                  0x0204C16Du
#define W2U_ADDR_CLACT_WORK_SET_AUTO_ANIMATION       0x0204C54Du
#define W2U_ADDR_CLACT_WORK_SET_SEQUENCE             0x0204C4B5u

#define W2U_ADDR_FIELD_CAN_USE_ITEM_ON_MON           0x021A2429u
#define W2U_ADDR_FIELD_MSG_CREATE_WORD_SET           0x0219FA19u
#define W2U_ADDR_FIELD_MSG_ADD_POKE_NAME             0x0219FA39u
#define W2U_ADDR_FIELD_MSG_DELETE_WORD_SET           0x0219FA29u
#define W2U_ADDR_WORD_SET_REGISTER_ABILITY_NAME      0x0202452Du
#define W2U_ADDR_FIELD_MESSAGE_WAIT_INIT             0x0219D78Du
#define W2U_ADDR_FIELD_YES_NO_WAIT_INIT              0x0219D815u
#define W2U_ADDR_FIELD_MSG_CLOSE_WINDOW              0x0219F83Du
#define W2U_ADDR_FIELD_RETURN_AFTER_ITEM_USE         0x0219DE59u
#define W2U_ADDR_FIELD_PLATE_REDRAW_PARAM            0x0219F351u
#define W2U_ADDR_FIELD_SUB_BAG_ITEM                  0x0219E689u

#endif

// This cache is reserved by the expansion runtime rather than an address in a
// relocated executable segment, so it intentionally remains common.
#define W2U_ADDR_BATTLE_SUMMARY_CACHE                0x022C4760u

#ifndef POKEBW2_CONSTANTS_ARC_H
#define POKEBW2_CONSTANTS_ARC_H

// Names, layouts and constants from swan (https://github.com/ds-pokemon-hacking/swan, GPL-3.0), except
// ARCID_WINFRAME, ARCID_TITLE, ARCID_STARTMENU, ARCID_SEASON_BANNER, ARCID_COPYRIGHT, ARCID_ZUKAN_GRA, ARCID_INTRO,
// ARCID_EGG_DEMO, ARCID_SHINKA_DEMO, ARCID_POKEICON, ARCID_BOX2, ARCID_TRAI_SCRIPT, ARCID_BMP_OAM, ARCID_INFOWIN,
// ARCID_APP_MENU_COMMON, ARCID_TPOKE, ARCID_P_STATUS, ARCID_PMSI, ARCID_MYSTERY and ARCID_PROF_WORD

#define ARCID_SYSTEM_MESSAGE 2
#define ARCID_SCRIPT_MESSAGE 3
#define ARCID_POKEGRA 4
#define ARCID_WINFRAME 5
// The Pokémon icons
#define ARCID_POKEICON 7
#define ARCID_MAP_TERRAIN 8
#define ARCID_MAP_MATRIX 9
#define ARCID_ZONEDATA 12
#define ARCID_AREADATA 13
#define ARCID_AREA_MAP_TEX 14
#define ARCID_AREA_EDGE_COLOR_TABLES 15
#define ARCID_PERSONAL 16
#define ARCID_GROWTBL 17
#define ARCID_LEARNSETS 18
#define ARCID_EVOLUTIONS 19
#define ARCID_BABYMONS 20
#define ARCID_WAZAINFO 21
#define ARCID_FONT 23
#define ARCID_ITEMINFO 24
#define ARCID_ITEMGRA 25
// The boot logos and the title screen's 2D graphics
#define ARCID_TITLE 26
// The Game Sync menu's graphics (gsync_menu.c). Our name, not swan's
#define ARCID_GSYNC_MENU 29
// Mystery Gift's graphics
#define ARCID_MYSTERY 33
// The start menu's graphics
#define ARCID_STARTMENU 34
// The Entralink monolith's graphics
#define ARCID_MONOLITH 38
// The sentence input's graphics, with the icons that sentences show in place of some words
#define ARCID_PMSI 42
// The musical's graphics (not from swan): its props' textures, the photo screen's touch screen and the stage's
#define ARCID_MUSICAL_ITEM 44
#define ARCID_MUSICAL_SHOT 45
#define ARCID_MUSICAL 46
#define ARCID_MMODEL_TBL 47
#define ARCID_MMODEL_GRA 48
#define ARCID_INFOWIN 49
// The cells and animations of bmp_oam.c's 32x16 actors, for each OBJ character mapping
#define ARCID_BMP_OAM 50
// The musical's Pokémon sprites, in the older layout of ARCID_POKEGRA (not from swan)
#define ARCID_MUSICAL_POKEGRA 51
#define ARCID_EVENT_SCRIPT 56
#define ARCID_FIELD_CAMERA_DEFAULT 59
#define ARCID_LIGHTS_FIELD 60
#define ARCID_LIGHTS_BATTLE 61
#define ARCID_AREA_ANIME_SRT 68
#define ARCID_AREA_ANIME_PAT 69
#define ARCID_TRSPRITE_FRONT 71
#define ARCID_TRSPRITE_BACK 72
// The graphics of the compatibility checker's ranking (irc_ranking.c). Our name, not swan's
#define ARCID_IRC_RANKING 76
// The summary screen's graphics
#define ARCID_P_STATUS 77
#define ARCID_RAIL_HEADERS 78
// The graphics that the menus share (app_menu_common.c)
#define ARCID_APP_MENU_COMMON 82
// The trainers' messages as pairs of trainer ID and message type, in trainer order, and the offset of each trainer's
// first pair (tr_tool.c; not from swan)
#define ARCID_TRTBL 89
#define ARCID_TRTBLOFS 90
#define ARCID_TRDATA 91
#define ARCID_TRPOKE 92
// The graphics of the compatibility result (irc_compat_result.c). Our name, not swan's
#define ARCID_IRC_COMPAT 93
// The Global Trade Station's 2D graphics (not from swan)
#define ARCID_WORLDTRADE 95
#define ARCID_CALENDAR 96
#define ARCID_GIMMICK_TBL 102
#define ARCID_FIELD_CAMERA_MAP_BOUNDARY 109
#define ARCID_RAIL_DATA 110
// The PC box's graphics
#define ARCID_BOX2 117
#define ARCID_ZONE_ENTITIES 126
#define ARCID_ENCOUNTDATA 127
// The interactive sound system's city sound units (iss_city_unit.c). Our name, not swan's
#define ARCID_ISS_CITY 133
// The interactive sound system's zone fades (iss_zone_sys.c). Our name, not swan's
#define ARCID_ISS_ZONE 136
// The Memory Link's picture of the two systems (data_convert_flow.c). Our name, not swan's
#define ARCID_DATA_CONVERT 139
// Game Sync's graphics (gsync_disp.c). Our name, not swan's
#define ARCID_GSYNC 143
// The Dream World account screens' graphics (pdwacc_disp.c). Our name, not swan's
#define ARCID_PDWACC 145
// The interactive sound system's dungeon BGM settings (iss_dungeon_sys.c). Our name, not swan's
#define ARCID_ISS_DUNGEON 146
// The interactive sound system's BGM switch sets (iss_switch_set.c). Our name, not swan's
#define ARCID_ISS_SWITCH 147
#define ARCID_MAPEFF_SKILL_TBL 149
#define ARCID_SEASON_BANNER 150
#define ARCID_FIELD_CAMERA_MAP_PARAM 156
// The Pokédex's graphics
#define ARCID_ZUKAN_GRA 157
#define ARCID_DEMO3D_RESOURCE 158
// The copyright notice that the game shows when it starts. swan names this archive ARCID_FIELD_CAMERA_SCRIPT_PARAM,
// but it holds 2D graphics
#define ARCID_COPYRIGHT 162
// The intro's graphics
#define ARCID_INTRO 168
#define ARCID_EGG_DEMO 186
#define ARCID_TRAI_SCRIPT 169
#define ARCID_FIELD_BBD_COLOR 173
#define ARCID_AREA_BMTEX_EXT 174
#define ARCID_AREA_BMTEX_INT 175
// The evolution demo's graphics
#define ARCID_SHINKA_DEMO 179
// The interactive sound system's 3D sound configs (iss_3ds_sys.c). Our name, not swan's
#define ARCID_ISS_3D_SOUND 182
// The walking Pokémon's object codes (tpoke_data.c)
#define ARCID_TPOKE 208
// The Marine Tube board's graphics on the main screen (marine_tube_board.c). Our name, not swan's
#define ARCID_MARINE_TUBE_BOARD 297
// The Pokédex diplomas' graphics (chihou_zukan_award.c and zenkoku_zukan_award.c). Our name, not swan's
#define ARCID_ZUKAN_AWARD 199
// The graphics of the Battle Subway's records screen (bsubway_records.c). Our name, not swan's
#define ARCID_BSUBWAY_RECORDS 196
// The Trial House results screen's graphics (th_award.c). Our name, not swan's
#define ARCID_TH_AWARD 198
// The subway map's graphics on the main screen (subway_map.c). Our name, not swan's
#define ARCID_SUBWAY_MAP 203
// The graphics of the "THE END" picture after the credits (the_end.c). Our name, not swan's
#define ARCID_THE_END 215
// The Research Radar's graphics. Our name, not swan's
#define ARCID_RESEARCH_RADAR 189
// The Unity Tower's floor select's graphics (un_select.c). Our name, not swan's
#define ARCID_UN_SELECT 190
// The Union Room's touch screen, union_subdisp.c. Our name, not swan's
#define ARCID_UNION_SUBDISP 88
// The Dowsing MCHN's graphics and map of the hidden items around the player. Our name, not swan's
#define ARCID_DOWSING 192
// The graphics that many apps share, such as the touch bar, which getUINarcIdx returns. Our name, not swan's
#define ARCID_APP_MENU_COMMON 82
// The lists of words that names may not contain, compressed and encrypted
#define ARCID_PROF_WORD 216
#define ARCID_CDEMO_GFLOGO 220
#define ARCID_CDEMO_OPENINGWB 221
#define ARCID_CDEMO_OPENINGSW 222
#define ARCID_AREA_BMDATA_EXT 225
#define ARCID_AREA_BMDATA_INT 226
// The Join Avenue's tables, which resort_binary.c loads. Our name, not swan's
#define ARCID_RESORT_BINARY 244
// The Pokestar Studios cut-ins' graphics and scripts, which pokewood_cutin.c loads. Our names, not swan's
// The cast lists of the movies, a file each. Our name
#define ARCID_POKEWOOD_CAST 272
// The graphics of the movie's opening, which pkwd_count.c loads
#define ARCID_PKWD_COUNT 271
#define ARCID_POKEWOOD_CUTIN_GRA 274
#define ARCID_POKEWOOD_CUTIN_SCRIPT 275
// Unova Link's graphics (not from swan)
#define ARCID_KEY_SYSTEM 277
// The graphics of the Pokémon World Tournament's win record and downloaded tournaments, overlay 326 (not from swan)
#define ARCID_WIN_RECORD 265
#define ARCID_T_DOWNLOAD 266
// The Pokémon World Tournament's touch screen (a/2/4/5), wbt_subscreen.c. Our name, not swan's
#define ARCID_WBT_SUBSCREEN 245
// The touch screen of no_gear.c (a/2/8/7): many palettes and screens that look like the C-Gear's. Our name and a
// guess, not swan's
#define ARCID_C_GEAR 287
// The models and animations of Humilau City's gym, which gym_humilau.c loads. Our name, not swan's
#define ARCID_GYM_HUMILAU 276
#define ARCID_GIMMICK_EXPOBJ_MARINETUBE 295

// The 2D graphics archives that the code loads by number, named after the source files that load them, or the
// app's prefix where several do (docs/data.md, 2D graphics). Our names, not swan's
#define ARCID_BTLV 11                     // btlv_scu.c, btlv_stage.c, pkwd_briefing.c
#define ARCID_ERROR_WINDOW_GRA 22         // net_err.c, error_window_screen.c, wfc_user_info_warning.c
#define ARCID_CONFIG_PANEL 27             // config_panel.c
#define ARCID_IRCBATTLE 28                // ircbattlemenu.c, ircbattlematch.c
#define ARCID_WIFI_2DCHAR 30              // wifi_2dchar.c, startmenu.c, worldtrade.c
#define ARCID_WIFI_UNIONCHAR 31           // wifi_2dchar.c
#define ARCID_WIFIP2PMATCH 32             // wifi_p2pmatch.c
#define ARCID_TRAINER_CARD_GRA 39         // trainer_card.c, trcard_obj.c, badge_view.c
#define ARCID_TRAINER_CARD_UNION_GRA 40   // trainer_card.c, badge_view.c
#define ARCID_SCRCMD_SHOP 53              // scrcmd_shop.c, scrcmd_resort_shop.c
#define ARCID_CODEIN 58                   // codein.c, br_codein.c
#define ARCID_WIFI_NOTE 62                // wifi_note.c
#define ARCID_FIELD_MENU 70               // field_menu.c, field_subscreen.c
#define ARCID_PLIST 75                    // plist_sys.c, plist_battle.c, plist_menu.c
#define ARCID_FIELD_PLACE_NAME 83         // field_place_name.c, namein.c
#define ARCID_TOWNMAP_GRA 84              // townmap.c, townmap_grh.c, zukan_detail_map.c
#define ARCID_ITEMMENU 87                 // itemmenu.c, itemmenu_disp.c
#define ARCID_BTLV_EFFVM_BG 94            // btlv_effvm.c
#define ARCID_B_BAG 98                    // b_bag_anm.c, b_bag_main.c, b_bag_obj.c
#define ARCID_B_PLIST 99                  // b_plist_main.c, vs_multi_list.c
#define ARCID_PKWD 100                    // pkwd_book.c, pkwd_record_monitor.c, pkwd_selectscreen.c
#define ARCID_B_CHOICE 101                // b_choice_main.c
#define ARCID_POKEMONTRADE 103            // pokemontrade_2d.c, pokemontrade_nego.c
#define ARCID_POKEMONTRADE_DEMO 104       // pokemontrade_demo_common.c, pokemontrade_demo_down.c
#define ARCID_POKEMONTRADE_2D 105         // pokemontrade_2d.c
#define ARCID_MIC_TEST 107                // mictest.c
#define ARCID_NAMEIN_GRAPHIC 119          // namein.c
#define ARCID_WAZA_OSHIE 125              // waza_oshie_main.c
#define ARCID_SHORTCUT_MENU 129           // shortcut_menu.c
#define ARCID_LOCAL_TVT 132               // local_tvt_chara.c, local_tvt_util.c
#define ARCID_WIFIBATTLEMATCH 134         // wifibattlematch_view.c
#define ARCID_BR_RES 137                  // br_res.c
#define ARCID_MB_PARENT_SYS 142           // mb_parent_sys.c
#define ARCID_GTSNEGO_DISP 144            // gtsnego_disp.c
#define ARCID_MAILBOX 153                 // mailview.c
#define ARCID_DEMO3D_2D 159               // demo3d_cmdsys.c
#define ARCID_TVT 170                     // comm_tvt_sys.c, local_tvt_chara.c, local_tvt_util.c
#define ARCID_BEACON 171                  // beacon_view_setup.c, beacon_detail.c
#define ARCID_COMM_BTL_DEMO 178           // comm_btl_demo.c
#define ARCID_GURU2 180                   // guru2_main.c
#define ARCID_GURU2_OBJ 181               // guru2_receipt.c, guru2_main.c
#define ARCID_FLD_FACEUP 184              // fld_faceup.c
#define ARCID_BTL_REC_SEL 185             // btl_rec_sel.c
#define ARCID_OEKAKI 188                  // oekaki.c
#define ARCID_REPORT 193                  // report.c
#define ARCID_GEONET 194                  // geonet.c
#define ARCID_TIME_ICON 195               // time_icon.c
#define ARCID_FIELD_SAVEANIME 197         // field_saveanime.c
#define ARCID_PSEL 202                    // psel.c
#define ARCID_DENDOU_PC 210               // dpc_main.c
#define ARCID_DENDOU_DEMO 213             // ddemo_main.c, ddemo_obj.c
#define ARCID_MANUAL 218                  // manual_common.c
#define ARCID_ASSERT_WINDOW_GRA 230       // net_err.c
#define ARCID_BTLV_EFFVM_PAL_ANIM 231     // btlv_effvm.c
#define ARCID_CTVT_GAME 233               // ctvt_game.c
#define ARCID_MEDALBOX 236                // medalbox.c
#define ARCID_MEDAL_INFO_VIEWER 237       // medal_info_viewer.c
#define ARCID_MEDAL 238                   // medalbox.c, medal_info_viewer.c
#define ARCID_CTVT_GAME_CAM 242           // ctvt_game_cam.c, ctvt_game.c
#define ARCID_FIELD_FMISSION_INFO 243     // field_fmission_info.c
#define ARCID_FMISSION_VIEW 259           // fmission_view_setup.c
#define ARCID_FLD3D_CI 267                // fld3d_ci.c
#define ARCID_FMISSION_APP 270            // fmission_app.c, fmission_app_draw.c
#define ARCID_GPOWER_APP 285              // gpower_app.c
#define ARCID_WBT_STADIUM_GIMMICK 291     // wbt_stadium_gimmick.c
#define ARCID_GIMMICK_POKEWOOD_POSTER 294 // gimmick_pokewood_poster.c
#define ARCID_GIMMICK 303                 // gimmick_aspertia_city.c, gimmick_league_center.c

#endif // POKEBW2_CONSTANTS_ARC_H

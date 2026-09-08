# Move AI sequence reference

Use this reference when selecting the move editor's **Effect** value. All 338 IDs (0–337) retain their original order in [`effects.txt`](../src/assets/data/effects.txt). Descriptions are unique under the editor's case-insensitive text lookup.

The assignments below cover the original Black / White (BW1) moves. Move-specific runtime behavior differs in BW2; check the target BW2 ROM independently before relying on these assignments.

## What this field means

The editor's `effect` field is the two-byte `AISeqNo` at offset 16 in a move
record. It classifies the move for trainer AI evaluation. The descriptions explain
the original move family associated with that ID, using Gen 5 behavior and defaults.
Selecting an ID alone does not implement its described battle effect. Move category,
status, stat changes, chances, targeting, and move-specific battle handlers are separate.

Some different IDs describe the same general battle outcome. Their original move
names distinguish those IDs without inventing a mechanical difference. In particular,
IDs 20, 70, and 330 all occur on Speed-lowering attacks; ID 20 is also String Shot's
AI sequence. IDs 271 and 296 describe Sp. Def reductions with different original
proc rates. "May" denotes a secondary effect, whose configured chance can be 100%.
Abilities, immunities, items, accuracy, and other battle conditions can prevent effects;
the labels are move-family summaries rather than exhaustive battle specifications.

An unused slot means no original move selects that ID, not that it is available to
install new behavior. Some unassigned stat and healing sequences still have AI routines.
Unidentified slots have unique, explicit unused labels rather than guessed mechanics.

## Complete ID coverage

Up to three representative moves per ID are shown. Parentheses contain move IDs,
not AI IDs. Unassigned stat/healing identities come from the AI source routines.

| AI ID | Original move examples / unassigned-slot evidence |
| --- | --- |
| 0 | Pound (1); Mega Punch (5); Scratch (10); +24 more |
| 1 | Sing (47); Sleep Powder (79); Hypnosis (95); +4 more |
| 2 | Poison Sting (40); Smog (123); Sludge (124); +4 more |
| 3 | Absorb (71); Mega Drain (72); Leech Life (141); +3 more |
| 4 | Fire Punch (7); Ember (52); Flamethrower (53); +7 more |
| 5 | Ice Punch (8); Ice Beam (58); Powder Snow (181) |
| 6 | Thunderpunch (9); Body Slam (34); Thundershock (84); +8 more |
| 7 | Selfdestruct (120); Explosion (153) |
| 8 | Dream Eater (138) |
| 9 | Mirror Move (119) |
| 10 | Meditate (96); Sharpen (159); Howl (336) |
| 11 | Harden (106); Withdraw (110) |
| 12 | Unused; Speed +1 AI routine |
| 13 | Unused; Sp. Atk +1 AI routine |
| 14 | Unused; Sp. Def +1 AI routine |
| 15 | Unused; Accuracy +1 AI routine |
| 16 | Double Team (104) |
| 17 | Swift (129); Faint Attack (185); Shadow Punch (325); +5 more |
| 18 | Growl (45) |
| 19 | Tail Whip (39); Leer (43) |
| 20 | String Shot (81); Low Sweep (490); Electroweb (527) |
| 21 | Unused; Sp. Atk -1 AI routine |
| 22 | Unused; Sp. Def -1 AI routine |
| 23 | Sand-Attack (28); Smokescreen (108); Kinesis (134); +1 more |
| 24 | Sweet Scent (230) |
| 25 | Haze (114) |
| 26 | Bide (117) |
| 27 | Thrash (37); Petal Dance (80); Outrage (200) |
| 28 | Whirlwind (18); Roar (46) |
| 29 | Doubleslap (3); Comet Punch (4); Fury Attack (31); +10 more |
| 30 | Conversion (160) |
| 31 | Rolling Kick (27); Headbutt (29); Bite (44); +14 more |
| 32 | Recover (105); Softboiled (135); Milk Drink (208); +2 more |
| 33 | Toxic (92) |
| 34 | Pay Day (6) |
| 35 | Light Screen (113) |
| 36 | Tri Attack (161) |
| 37 | Rest (156) |
| 38 | Guillotine (12); Horn Drill (32); Fissure (90); +1 more |
| 39 | Razor Wind (13) |
| 40 | Super Fang (162) |
| 41 | Dragon Rage (82) |
| 42 | Bind (20); Wrap (35); Fire Spin (83); +3 more |
| 43 | Karate Chop (2); Razor Leaf (75); Crabhammer (152); +12 more |
| 44 | Double Kick (24); Bonemerang (155); Double Hit (458); +2 more |
| 45 | Jump Kick (26); Hi Jump Kick (136) |
| 46 | Mist (54) |
| 47 | Focus Energy (116) |
| 48 | Take Down (36); Submission (66); Wild Charge (528); +1 more |
| 49 | Supersonic (48); Confuse Ray (109); Sweet Kiss (186) |
| 50 | Swords Dance (14) |
| 51 | Barrier (112); Acid Armor (151); Iron Defense (334) |
| 52 | Agility (97); Rock Polish (397) |
| 53 | Nasty Plot (417) |
| 54 | Amnesia (133) |
| 55 | Unused; Accuracy +2 AI routine |
| 56 | Unused; Evasion +2 AI routine |
| 57 | Transform (144) |
| 58 | Charm (204); Featherdance (297) |
| 59 | Screech (103) |
| 60 | Cotton Spore (178); Scary Face (184) |
| 61 | Unused; Sp. Atk -2 AI routine |
| 62 | Fake Tears (313); Metal Sound (319) |
| 63 | Unused; Accuracy -2 AI routine |
| 64 | Unused; Evasion -2 AI routine |
| 65 | Reflect (115) |
| 66 | Poisonpowder (77); Poison Gas (139) |
| 67 | Stun Spore (78); Thunder Wave (86); Glare (137) |
| 68 | Aurora Beam (62) |
| 69 | Iron Tail (231); Crunch (242); Rock Smash (249); +2 more |
| 70 | Bubblebeam (61); Constrict (132); Bubble (145); +4 more |
| 71 | Mist Ball (296); Struggle Bug (522); Snarl (555) |
| 72 | Acid (51); Psychic (94); Shadow Ball (247); +6 more |
| 73 | Mud-Slap (189); Octazooka (190); Muddy Water (330); +4 more |
| 74 | Unused; no original move assigned |
| 75 | Sky Attack (143) |
| 76 | Psybeam (60); Confusion (93); Dizzy Punch (146); +4 more |
| 77 | Twineedle (41) |
| 78 | Vital Throw (233) |
| 79 | Substitute (164) |
| 80 | Hyper Beam (63); Blast Burn (307); Hydro Cannon (308); +4 more |
| 81 | Rage (99) |
| 82 | Mimic (102) |
| 83 | Metronome (118) |
| 84 | Leech Seed (73) |
| 85 | Splash (150) |
| 86 | Disable (50) |
| 87 | Seismic Toss (69); Night Shade (101) |
| 88 | Psywave (149) |
| 89 | Counter (68) |
| 90 | Encore (227) |
| 91 | Pain Split (220) |
| 92 | Snore (173) |
| 93 | Conversion 2 (176) |
| 94 | Mind Reader (170); Lock-On (199) |
| 95 | Sketch (166) |
| 96 | Unused; no original move assigned |
| 97 | Sleep Talk (214) |
| 98 | Destiny Bond (194) |
| 99 | Flail (175); Reversal (179) |
| 100 | Spite (180) |
| 101 | False Swipe (206) |
| 102 | Heal Bell (215); Aromatherapy (312) |
| 103 | Quick Attack (98); Mach Punch (183); Extremespeed (245); +5 more |
| 104 | Triple Kick (167) |
| 105 | Thief (168); Covet (343) |
| 106 | Spider Web (169); Mean Look (212); Block (335) |
| 107 | Nightmare (171) |
| 108 | Minimize (107) |
| 109 | Curse (174) |
| 110 | Unused; no original move assigned |
| 111 | Protect (182); Detect (197) |
| 112 | Spikes (191) |
| 113 | Foresight (193); Odor Sleuth (316) |
| 114 | Perish Song (195) |
| 115 | Sandstorm (201) |
| 116 | Endure (203) |
| 117 | Rollout (205); Ice Ball (301) |
| 118 | Swagger (207) |
| 119 | Fury Cutter (210) |
| 120 | Attract (213) |
| 121 | Return (216) |
| 122 | Present (217) |
| 123 | Frustration (218) |
| 124 | Safeguard (219) |
| 125 | Flame Wheel (172); Sacred Fire (221) |
| 126 | Magnitude (222) |
| 127 | Baton Pass (226) |
| 128 | Pursuit (228) |
| 129 | Rapid Spin (229) |
| 130 | Sonicboom (49) |
| 131 | Unused; no original move assigned |
| 132 | Morning Sun (234); Synthesis (235); Moonlight (236) |
| 133 | Unused legacy Synthesis sequence |
| 134 | Unused legacy Moonlight sequence |
| 135 | Hidden Power (237) |
| 136 | Rain Dance (240) |
| 137 | Sunny Day (241) |
| 138 | Steel Wing (211) |
| 139 | Metal Claw (232); Meteor Mash (309) |
| 140 | Ancientpower (246); Silver Wind (318); Ominous Wind (466) |
| 141 | Unused; no original move assigned |
| 142 | Belly Drum (187) |
| 143 | Psych Up (244) |
| 144 | Mirror Coat (243) |
| 145 | Skull Bash (130) |
| 146 | Twister (239) |
| 147 | Earthquake (89) |
| 148 | Future Sight (248); Doom Desire (353) |
| 149 | Gust (16) |
| 150 | Stomp (23); Steamroller (537) |
| 151 | Solarbeam (76) |
| 152 | Thunder (87) |
| 153 | Teleport (100) |
| 154 | Beat Up (251) |
| 155 | Fly (19) |
| 156 | Defense Curl (111) |
| 157 | Unused legacy Soft-Boiled sequence |
| 158 | Fake Out (252) |
| 159 | Uproar (253) |
| 160 | Stockpile (254) |
| 161 | Spit Up (255) |
| 162 | Swallow (256) |
| 163 | Unused; no original move assigned |
| 164 | Hail (258) |
| 165 | Torment (259) |
| 166 | Flatter (260) |
| 167 | Will-O-Wisp (261) |
| 168 | Memento (262) |
| 169 | Facade (263) |
| 170 | Focus Punch (264) |
| 171 | Smellingsalt (265) |
| 172 | Follow Me (266); Rage Powder (476) |
| 173 | Nature Power (267) |
| 174 | Charge (268) |
| 175 | Taunt (269) |
| 176 | Helping Hand (270) |
| 177 | Trick (271); Switcheroo (415) |
| 178 | Role Play (272) |
| 179 | Wish (273) |
| 180 | Assist (274) |
| 181 | Ingrain (275) |
| 182 | Superpower (276) |
| 183 | Magic Coat (277) |
| 184 | Recycle (278) |
| 185 | Revenge (279); Avalanche (419) |
| 186 | Brick Break (280) |
| 187 | Yawn (281) |
| 188 | Knock Off (282) |
| 189 | Endeavor (283) |
| 190 | Eruption (284); Water Spout (323) |
| 191 | Skill Swap (285) |
| 192 | Imprison (286) |
| 193 | Refresh (287) |
| 194 | Grudge (288) |
| 195 | Snatch (289) |
| 196 | Low Kick (67); Grass Knot (447) |
| 197 | Secret Power (290) |
| 198 | Double-Edge (38); Brave Bird (413); Wood Hammer (452) |
| 199 | Teeter Dance (298) |
| 200 | Blaze Kick (299) |
| 201 | Mud Sport (300) |
| 202 | Poison Fang (305) |
| 203 | Weather Ball (311) |
| 204 | Overheat (315); Psycho Boost (354); Draco Meteor (434); +1 more |
| 205 | Tickle (321) |
| 206 | Cosmic Power (322); Defend Order (455) |
| 207 | Sky Uppercut (327) |
| 208 | Bulk Up (339) |
| 209 | Poison Tail (342); Cross Poison (440) |
| 210 | Water Sport (346) |
| 211 | Calm Mind (347) |
| 212 | Dragon Dance (349) |
| 213 | Camouflage (293) |
| 214 | Roost (355) |
| 215 | Gravity (356) |
| 216 | Miracle Eye (357) |
| 217 | Wake-Up Slap (358) |
| 218 | Hammer Arm (359) |
| 219 | Gyro Ball (360) |
| 220 | Healing Wish (361) |
| 221 | Brine (362) |
| 222 | Natural Gift (363) |
| 223 | Feint (364) |
| 224 | Pluck (365); Bug Bite (450) |
| 225 | Tailwind (366) |
| 226 | Acupressure (367) |
| 227 | Metal Burst (368) |
| 228 | U-Turn (369); Volt Switch (521) |
| 229 | Close Combat (370) |
| 230 | Payback (371) |
| 231 | Assurance (372) |
| 232 | Embargo (373) |
| 233 | Fling (374) |
| 234 | Psycho Shift (375) |
| 235 | Trump Card (376) |
| 236 | Heal Block (377) |
| 237 | Wring Out (378); Crush Grip (462) |
| 238 | Power Trick (379) |
| 239 | Gastro Acid (380) |
| 240 | Lucky Chant (381) |
| 241 | Me First (382) |
| 242 | Copycat (383) |
| 243 | Power Swap (384) |
| 244 | Guard Swap (385) |
| 245 | Punishment (386) |
| 246 | Last Resort (387) |
| 247 | Worry Seed (388) |
| 248 | Sucker Punch (389) |
| 249 | Toxic Spikes (390) |
| 250 | Heart Swap (391) |
| 251 | Aqua Ring (392) |
| 252 | Magnet Rise (393) |
| 253 | Flare Blitz (394) |
| 254 | Struggle (165) |
| 255 | Dive (291) |
| 256 | Dig (91) |
| 257 | Surf (57) |
| 258 | Defog (432) |
| 259 | Trick Room (433) |
| 260 | Blizzard (59) |
| 261 | Whirlpool (250) |
| 262 | Volt Tackle (344) |
| 263 | Bounce (340) |
| 264 | Unused; no original move assigned |
| 265 | Captivate (445) |
| 266 | Stealth Rock (446) |
| 267 | Chatter (448) |
| 268 | Judgment (449); Techno Blast (546) |
| 269 | Head Smash (457) |
| 270 | Lunar Dance (461) |
| 271 | Seed Flare (465) |
| 272 | Shadow Force (467) |
| 273 | Fire Fang (424) |
| 274 | Ice Fang (423) |
| 275 | Thunder Fang (422) |
| 276 | Charge Beam (451); Fiery Dance (552) |
| 277 | Hone Claws (468) |
| 278 | Wide Guard (469) |
| 279 | Guard Split (470) |
| 280 | Power Split (471) |
| 281 | Wonder Room (472) |
| 282 | Psyshock (473); Psystrike (540); Secret Sword (548) |
| 283 | Venoshock (474) |
| 284 | Autotomize (475) |
| 285 | Telekinesis (477) |
| 286 | Magic Room (478) |
| 287 | Smack Down (479) |
| 288 | Storm Throw (480); Frost Breath (524) |
| 289 | Flame Burst (481) |
| 290 | Quiver Dance (483) |
| 291 | Heavy Slam (484); Heat Crash (535) |
| 292 | Synchronoise (485) |
| 293 | Electro Ball (486) |
| 294 | Soak (487) |
| 295 | Flame Charge (488) |
| 296 | Acid Spray (491) |
| 297 | Foul Play (492) |
| 298 | Simple Beam (493) |
| 299 | Entrainment (494) |
| 300 | After You (495) |
| 301 | Round (496) |
| 302 | Echoed Voice (497) |
| 303 | Chip Away (498); Sacred Sword (533) |
| 304 | Clear Smog (499) |
| 305 | Stored Power (500) |
| 306 | Quick Guard (501) |
| 307 | Ally Switch (502) |
| 308 | Shell Smash (504) |
| 309 | Heal Pulse (505) |
| 310 | Hex (506) |
| 311 | Sky Drop (507) |
| 312 | Shift Gear (508) |
| 313 | Circle Throw (509); Dragon Tail (525) |
| 314 | Incinerate (510) |
| 315 | Quash (511) |
| 316 | Growth (74) |
| 317 | Acrobatics (512) |
| 318 | Reflect Type (513) |
| 319 | Retaliate (514) |
| 320 | Final Gambit (515) |
| 321 | Tail Glow (294) |
| 322 | Coil (489) |
| 323 | Bestow (516) |
| 324 | Water Pledge (518) |
| 325 | Fire Pledge (519) |
| 326 | Grass Pledge (520) |
| 327 | Work Up (526) |
| 328 | Cotton Guard (538) |
| 329 | Relic Song (547) |
| 330 | Glaciate (549) |
| 331 | Freeze Shock (553) |
| 332 | Ice Burn (554) |
| 333 | Unused legacy Snarl sequence; no-op basic/expert routines |
| 334 | V-Create (557) |
| 335 | Fusion Flare (558) |
| 336 | Fusion Bolt (559) |
| 337 | Hurricane (542) |

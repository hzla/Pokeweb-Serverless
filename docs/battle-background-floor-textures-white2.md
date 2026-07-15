# Pokémon White 2 battle-background floor textures

Generated from `../cleanwhite2.nds` (game code `IRDO`, SHA-256 `3e50aec3db401332175a5d2b5fe2a68ac1a05ec63995dba9d1506b1b51837446`).

This table covers the **field/background NSBMD** selected by `a/1/5/1` and stored in `a/0/1/1`. Pokémon platforms are separate stage models and are not included.

Candidates are found from actual model geometry: triangles whose plane is at least 75% horizontal are grouped by material/texture, then ranked by projected area and coverage around the battle center. Texture names are used only to reject obvious sky, wall, prop, and effect layers. `fallback` means the season has no explicit model and uses Spring's model.

| Background | Season(s) | NSBMD member | Floor material → texture | Size / format | Role | Confidence | Notes |
|---:|---|---:|---|---|---|---|---|
| 0 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 74 | `batt_field04` → `batt_field01` | 64×64 / 256-color | primary | high |  |
| 1 | Spring<br>Autumn (fallback)<br>Winter (fallback) | 77 | `batt_field01_1` → `batt_field01` | 64×64 / 256-color | primary | high |  |
| 1 | Summer | 79 | `batt_field23d_1` → `batt_field23d` | 64×64 / 256-color | primary | high |  |
| 2 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 84 | `batt_field04a_1` → `batt_field04a` | 64×64 / 256-color | primary | high |  |
| 3 | Spring<br>Autumn (fallback)<br>Winter (fallback) | 87 | `batt_field04b_1` → `batt_field04b` | 64×64 / 256-color | primary | high |  |
| 3 | Summer | 89 | `batt_field04d_1` → `batt_field04d` | 64×64 / 256-color | primary | high |  |
| 4 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 94 | `batt_field05_1` → `batt_field05` | 64×64 / 256-color | primary | high |  |
| 5 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 95 | `batt_field05_1` → `batt_field05` | 64×64 / 256-color | primary | high |  |
| 6 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 96 | `batt_field07_1` → `batt_field07` | 64×64 / 256-color | primary | high |  |
| 7 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 98 | `batt_field08_1` → `batt_field08` | 64×64 / 256-color | primary | high |  |
| 8 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 99 | `batt_field04` → `batt_field09` | 64×64 / 256-color | primary | high |  |
| 9 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 101 | `batt_field10_1` → `batt_field10` | 64×64 / 256-color | primary | high |  |
| 10 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 102 | `batt_field11_1` → `batt_field11` | 64×64 / 256-color | primary | high |  |
| 11 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 103 | `batt_field04` → `batt_field14` | 64×64 / 256-color | primary | high |  |
| 12 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 105 | `batt_field15_1` → `batt_field15` | 64×64 / 256-color | primary | high |  |
| 13 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 107 | `batt_field15_1` → `batt_field16` | 64×64 / 256-color | primary | high |  |
| 14 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 109 | `batt_field15_1` → `batt_field17` | 64×64 / 256-color | primary | high |  |
| 15 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 111 | `batt_field15_1` → `batt_field18` | 64×64 / 256-color | primary | high |  |
| 16 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 98 | `batt_field08_1` → `batt_field08` | 64×64 / 256-color | primary | high |  |
| 17 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 113 | `batt_field04` → `batt_field20` | 64×64 / 256-color | primary | high |  |
| 18 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 115 | `batt_field21n_1` → `batt_field21n`<br>`batt_field21_1` → `batt_field21` | 128×64 / A3I5<br>64×64 / 256-color | primary<br>primary | high<br>high |  |
| 19 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 118 | `batt_fd_vs3_1` → `batt_fd_vs3` | 64×64 / 256-color | primary | high |  |
| 20 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 120 | `batt_field04` → `pkwd_field00a`<br>`file22Material` → `pkwd_field00e`<br>`file19Material` → `pkwd_field00b` | 128×64 / 256-color<br>32×32 / 16-color<br>32×32 / A5I3 | primary<br>secondary<br>primary | high<br>medium<br>high |  |
| 21 | Spring<br>Summer (fallback) | 121 | `roof_road_1` → `roof_road` | 32×32 / 16-color | primary | high |  |
| 21 | Autumn | 123 | `roof_road_1` → `roof_road` | 32×32 / 16-color | primary | high |  |
| 21 | Winter | 125 | `roof_road_1` → `roof_road` | 32×32 / 16-color | primary | high |  |
| 22 | Spring<br>Summer (fallback) | 141 | `park_ground_1` → `park_ground`<br>`park_ground2_1` → `park_ground2` | 32×32 / 256-color<br>16×16 / 256-color | primary<br>primary | high<br>high |  |
| 22 | Autumn | 143 | `park_ground_1` → `park_ground`<br>`park_ground2_1` → `park_ground2` | 32×32 / 256-color<br>16×16 / 256-color | primary<br>primary | high<br>high |  |
| 22 | Winter | 145 | `park_ground` → `park_ground`<br>`park_ground2` → `park_ground2` | 32×32 / 256-color<br>16×16 / 256-color | primary<br>primary | high<br>high |  |
| 23 | Spring<br>Summer (fallback) | 161 | `city_ground_1` → `city_ground`<br>`city_road_1` → `city_road` | 64×64 / 256-color<br>64×64 / 256-color | primary<br>primary | high<br>high |  |
| 23 | Autumn | 163 | `city_ground_1` → `city_ground`<br>`city_road_1` → `city_road` | 64×64 / 256-color<br>64×64 / 256-color | primary<br>primary | high<br>high |  |
| 23 | Winter | 165 | `city_ground_1` → `city_ground`<br>`city_road_1` → `city_road` | 64×64 / 256-color<br>64×64 / 256-color | primary<br>primary | high<br>high |  |
| 24 | Spring<br>Summer (fallback)<br>Winter (fallback) | 181 | `future_line_1` → `future_line` | 32×32 / 256-color | primary | high | Also contains a large untextured base plane. |
| 24 | Autumn | 182 | `future_line_1` → `future_line` | 32×32 / 256-color | primary | high | Also contains a large untextured base plane. |
| 25 | Spring<br>Summer (fallback) | 189 | `sands_sea_1` → `sands_sea`<br>`sands_wave_1` → `sands_wave`<br>`sands_shadow_2` → `sands_shadow`<br>`sands_sand_1` → `sands_sand` | 32×32 / 16-color<br>64×64 / A3I5<br>64×64 / A5I3<br>64×64 / 16-color | primary<br>primary<br>primary<br>secondary | high<br>high<br>high<br>medium |  |
| 25 | Autumn | 191 | `sands_sea_1` → `sands_sea`<br>`sands_wave_1` → `sands_wave`<br>`sands_shadow_2` → `sands_shadow`<br>`sands_sand_1` → `sands_sand` | 32×32 / 16-color<br>64×64 / A3I5<br>64×64 / A5I3<br>64×64 / 16-color | primary<br>primary<br>primary<br>secondary | high<br>high<br>high<br>medium |  |
| 25 | Winter | 192 | `sands_sea_1` → `sands_sea`<br>`sands_wave_1` → `sands_wave`<br>`sands_shadow_2` → `sands_shadow`<br>`sands_sand_1` → `sands_sand` | 32×32 / 16-color<br>64×64 / A3I5<br>64×64 / A5I3<br>64×64 / 16-color | primary<br>primary<br>primary<br>secondary | high<br>high<br>high<br>medium |  |
| 26 | Spring<br>Summer (fallback) | 205 | `wharf_ground_1` → `wharf_ground` | 32×32 / 256-color | primary | high |  |
| 26 | Autumn | 207 | `wharf_ground_1` → `wharf_ground` | 32×32 / 256-color | primary | high |  |
| 26 | Winter | 208 | `wharf_wave_1` → `wharf_wave`<br>`wharf_ground_1` → `wharf_ground` | 32×32 / A5I3<br>32×32 / 256-color | primary<br>primary | high<br>high |  |
| 27 | Spring<br>Summer (fallback) | 221 | `park_ground_1` → `park_ground`<br>`park_ground2_1` → `park_ground2` | 32×32 / 256-color<br>16×16 / 256-color | primary<br>primary | high<br>high |  |
| 27 | Autumn | 223 | `park_ground_1` → `park_ground`<br>`park_ground2_1` → `park_ground2` | 32×32 / 256-color<br>16×16 / 256-color | primary<br>primary | high<br>high |  |
| 27 | Winter | 224 | `park_ground_1` → `park_ground`<br>`park_ground2_1` → `park_ground2` | 32×32 / 256-color<br>16×16 / 256-color | primary<br>primary | high<br>high |  |
| 28 | Spring<br>Summer (fallback) | 237 | `magi_ground_1` → `magi_ground` | 32×32 / 256-color | primary | high |  |
| 28 | Autumn | 239 | `magi_ground_1` → `magi_ground2` | 32×32 / 256-color | primary | high | Also contains a large untextured base plane. |
| 28 | Winter | 240 | `magi_ground2_1` → `magi_ground2` | 32×32 / 256-color | primary | high |  |
| 29 | Spring<br>Summer (fallback) | 253 | `cmtry_ground_1` → `cmtry_ground`<br>`cmtry_ground2_1` → `cmtry_ground2` | 32×32 / 256-color<br>32×32 / 256-color | primary<br>secondary | high<br>medium |  |
| 29 | Autumn | 255 | `cmtry_ground_1` → `cmtry_ground`<br>`cmtry_ground2_1` → `cmtry_ground2` | 32×32 / 256-color<br>32×32 / 256-color | primary<br>secondary | high<br>medium |  |
| 29 | Winter | 257 | `cmtry_ground_1` → `cmtry_ground`<br>`cmtry_ground2_1` → `cmtry_ground2` | 32×32 / 256-color<br>32×32 / 256-color | primary<br>secondary | high<br>medium |  |
| 30 | Spring<br>Summer (fallback) | 273 | `fctry_floor2_1` → `fctry_floor2`<br>`fctry_floor_1` → `fctry_floor` | 32×32 / 16-color<br>32×32 / 16-color | primary<br>secondary | high<br>medium |  |
| 30 | Autumn | 275 | `fctry_floor2_2` → `fctry_floor2`<br>`fctry_floor_1` → `fctry_floor` | 32×32 / 16-color<br>32×32 / 16-color | primary<br>primary | high<br>high |  |
| 30 | Winter | 277 | `fctry_floor2_1` → `fctry_floor2`<br>`fctry_floor_1` → `fctry_floor` | 32×32 / 16-color<br>32×32 / 16-color | primary<br>secondary | high<br>medium |  |
| 31 | Spring<br>Summer (fallback) | 293 | `room_ground_1` → `room_ground` | 32×32 / 256-color | primary | high |  |
| 31 | Autumn | 295 | `room_ground_1` → `room_ground` | 32×32 / 256-color | primary | high |  |
| 31 | Winter | 297 | `room_ground_1` → `room_ground` | 32×32 / 256-color | primary | high |  |
| 32 | Spring<br>Summer (fallback)<br>Winter (fallback) | 313 | `city_ground_1` → `city_ground`<br>`city_road_1` → `city_road` | 64×64 / 256-color<br>64×64 / 256-color | primary<br>primary | high<br>high |  |
| 32 | Autumn | 315 | `city_ground_1` → `city_ground`<br>`city_road_1` → `city_road` | 64×64 / 256-color<br>64×64 / 256-color | primary<br>primary | high<br>high |  |
| 33 | Spring<br>Summer (fallback)<br>Winter (fallback) | 325 | `sky_cloud_1` → `sky_cloud`<br>`sky_cloud_b_1` → `sky_cloud_b` | 64×64 / A3I5<br>64×64 / A3I5 | primary<br>primary | high<br>high | Also contains a large untextured base plane. |
| 33 | Autumn | 327 | `space_field_1` → `space_field` | 128×128 / 256-color | primary | high |  |
| 34 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 335 | `batt_field04` → `pkwd_field01`<br>`batt_sky01` → `pkwd_field02`<br>`file15Material` → `pkwd_field01a` | 128×64 / 256-color<br>64×64 / 256-color<br>16×16 / 16-color | primary<br>secondary<br>secondary | high<br>medium<br>medium |  |
| 35 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 335 | `batt_field04` → `pkwd_field01`<br>`batt_sky01` → `pkwd_field02`<br>`file15Material` → `pkwd_field01a` | 128×64 / 256-color<br>64×64 / 256-color<br>16×16 / 16-color | primary<br>secondary<br>secondary | high<br>medium<br>medium |  |
| 36 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 335 | `batt_field04` → `pkwd_field01`<br>`batt_sky01` → `pkwd_field02`<br>`file15Material` → `pkwd_field01a` | 128×64 / 256-color<br>64×64 / 256-color<br>16×16 / 16-color | primary<br>secondary<br>secondary | high<br>medium<br>medium |  |
| 37 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 336 | `batt_field27_1` → `batt_field27` | 64×64 / 256-color | primary | high |  |
| 38 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 339 | `batt_field15_1` → `batt_field_w1` | 64×64 / 256-color | primary | high |  |
| 39 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 340 | `batt_field15_1` → `batt_field_w1` | 64×64 / 256-color | primary | high |  |
| 40 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 341 | `batt_field15_1` → `batt_field_w1` | 64×64 / 256-color | primary | high |  |
| 41 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 342 | `batt_field15_1` → `batt_field_w1` | 64×64 / 256-color | primary | high |  |
| 42 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 343 | `batt_field15_1` → `batt_field_b1` | 64×64 / 256-color | primary | high |  |
| 43 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 344 | `batt_field15_1` → `batt_field_b2` | 64×64 / 256-color | primary | high |  |
| 44 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 345 | `batt_field15_1` → `batt_field_b3` | 64×64 / 256-color | primary | high |  |
| 45 | Spring<br>Summer (fallback)<br>Autumn (fallback)<br>Winter (fallback) | 346 | `batt_field15_1` → `batt_field_b4` | 64×64 / 256-color | primary | high |  |
| 46 | Spring<br>Summer (fallback)<br>Winter (fallback) | 347 | `batt_field31_1` → `batt_field31` | 64×64 / 256-color | primary | high |  |
| 46 | Autumn | 348 | `batt_field31_1` → `batt_field31` | 64×64 / 256-color | primary | high |  |

## Interpretation

- A **primary** texture covers most of the central horizontal surface or dominates projected floor area.
- A **secondary** texture is a meaningful layered/partial floor surface, such as water, road, edging, or an animated detail plane.
- Compound scenes can require swapping more than one listed texture to recolor the complete visible floor.
- This is deliberately conservative: small horizontal prop surfaces are excluded even when they share a field-like asset family.

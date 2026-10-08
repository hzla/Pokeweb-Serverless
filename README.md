# Pokeweb Serverless

Pokeweb Serverless is a browser-based Gen 5 ROM editor for Pokemon Black, White, Black 2, and White 2. 

## Editor Coverage

### ROM and Project Tools

- Choose which narcs to load to save memory
- File System Browser
- Bunlded code injection made by the community and Hzla

### Maps, Headers, and Overworlds

- Header editor for map header fields such as map type, texture/matrix/script/text references, music, encounter id, parent map, location name, weather, camera, fly coordinates, and packed header flags.
- Overworld editor launched from headers, with npcs, sprite/object metadata, movement, sight range, flags, and zoom controls.
- 3D map viewer/editor for map metadata, season selection, building/NPC/entity overlays, collision and permission overlays, permission painting, and selected-tile flag application.

### Pokemon Data

- Pokemon personals, learnsets, evos, tm/tutor compatability, egg moves, sprites, and animations

### Trainers and Battle Facilities

- Trainer editor for trainer data/text
- Battle Facility editor for BW2 Subway/PWT-style set libraries and trainer choices

### Encounters and Locations

- Wild encounter editor
- BW2 habitat sync from encounter data.
- Static Encounter/Scripted Encounter editor
- Hidden Grotto editor .

### Moves, Items, TMs, and Types

- Move data editor 
- Move animation and particle tools from the move rows, including macro-style script editing, animation previews with audio, SPA archive loading, particle/resource editing, texture viewing, and SPA export/update support.
- Item data editor 
- TM/HM editor for move assignment, search/filter by move type and category, and BW2 icon pallete sync
- BW2 type chart editor for type-effectiveness values, including fairy support

### Text and Documentation

- Story Text and Info Text editors for searching text banks, opening banks, editing entries, and adding/deleting entries at the end of a bank.
- Doc Generators for Dynamic Calc and Dynamic Dex integration.
- Changelog Generator compares selected NARCs between two ROMs, with individual or combined PDF and TXT exports. PDFs include a clickable table of contents and document outline bookmarks for every changed Pokemon, move, trainer, and other named entry. Original and updated values use aligned comparison tables; TXT exports uppercase changed values. Personal, learnset, and evolution changes share a Pokemon document, and trainer settings and teams share a Trainers document.
>>>>>>> c241b8103ecb974d57aadc5de2faf55c01f6d713

## Quick Start

```sh
npm install
npm run dev
```

Then open the local Vite URL, load a `.nds`, choose the NARC groups you want available, make edits, and use `Export` to build the modified ROM.

## Credits

Should users choose to install from the animated sprite library, or move animation expansion library, relevant credits are listed on the install pages.

Reference projects used while building:

- ndspy: https://github.com/RoadrunnerWMC/ndspy
- ndstool: https://github.com/blocksds/ndstool
- Tinke: https://github.com/pleonex/tinke
- NitroPaint: https://github.com/Garhoogin/NitroPaint
- apicula: https://github.com/scurest/apicula
- nitroefx: https://github.com/Fexty12573/nitroefx
- CTRMap-CE: https://github.com/ds-pokemon-hacking/CTRMap-CE
- CTRMapV: https://github.com/ds-pokemon-hacking/CTRMapV
- Frost's Gen 5 Editor: https://github.com/FrostFalcon/FrostsGen5Editor
- dex-editor: https://github.com/RavenDS/dex-editor
- Aseprite: https://github.com/aseprite/aseprite
- White2Upgrade: https://github.com/ds-pokemon-hacking/White2Upgrade

Pokeweb is released under the MIT License: https://opensource.org/licenses/MIT

"""Build-time adapters for the existing split PWAN battle/summary sources.

Every replacement is anchored and checked. The input checkout is read only.
"""
def replace(text, old, new, count=1):
    if text.count(old) != count:
        raise ValueError(f'PWAN source changed; review adapter anchor: {old[:80]}')
    return text.replace(old, new)

def adapt_battle(text):
    text = '#include "runtime.h"\n' + text
    # Native fades intentionally change the fade buffer without changing the
    # source palette. Treat only a changed source as a resource replacement.
    text = replace(text, 'if (base[i] != asset->palette[i] || fade[i] != asset->palette[i]) {', 'if (base[i] != asset->palette[i]) {')
    text = replace(text, '    b32 shiny;\n', '    b32 shiny;\n    u32 nature;\n', 2)
    text = replace(text, '    u16 palette[16];', '    u16 palette[16];\n    u32 natureKey;')
    text = replace(text, 'static b32 LoadAsset(ActorId actor, BattleAssetId assetId)', 'static b32 LoadAsset(ActorId actor, BattleAssetId assetId, const BattleActorIdentity& identity)')
    text = replace(text, '    Asset *asset = &sState.asset[actor];\n    if (asset->loaded && asset->assetId == (u32)assetId) {\n        return true;\n    }', '''    Asset *asset = &sState.asset[actor];
    const u32 sprite = nature_palettes::sprite(identity.species, identity.form);
    const u32 key = nature_palettes::key(sprite, (kActorConfig[actor].position & 1) ? 1 : 2, identity.nature, identity.shiny);
    if (asset->loaded && asset->assetId == (u32)assetId) {
        if (asset->natureKey != key) {
            if (!ReadRange(assetId, asset->header.paletteOffset, asset->palette, sizeof(asset->palette))) return false;
            if (identity.nature < 25) nature_palettes::apply(asset->palette, key);
            asset->natureKey = key;
        }
        return true;
    }''')
    anchor = '''    if (!ReadRange(assetId, asset->header.paletteOffset, asset->palette, sizeof(asset->palette))) {
        return false;
    }'''
    text = replace(text, anchor, anchor + '\n    if (identity.nature < 25) nature_palettes::apply(asset->palette, key);\n    asset->natureKey = key;')
    text = replace(text, '    identity.shiny = false;', '    identity.shiny = false;\n    identity.nature = 255;')
    text = replace(text, '        none.shiny = false;', '        none.shiny = false;\n        none.nature = 255;')
    text = replace(text, '        identity.shiny = GetMcssIsShiny(bmw, position);', '        identity.shiny = GetMcssIsShiny(bmw, position);\n        identity.nature = PWNP_BattleNature(position);')
    text = replace(text, '!LoadAsset(actor, assetId)', '!LoadAsset(actor, assetId, identity)')
    text = replace(text, '!LoadAsset((ActorId)position, targetAsset)', '!LoadAsset((ActorId)position, targetAsset, identity)')
    text = replace(text, 'actorState->shiny != identity.shiny ||', 'actorState->shiny != identity.shiny ||\n                               actorState->nature != identity.nature ||')
    text = replace(text, '    actorState->shiny = identity.shiny;', '    actorState->shiny = identity.shiny;\n    actorState->nature = identity.nature;')
    # A native resource reload can enqueue a texture upload after this draw.
    # Refresh twice on that event, then resume ordinary frame-change uploads.
    # Keep the event in the existing dirty word; no new actor storage is needed.
    text = replace(text, 'static State sState;', '''static State sState;
extern "C" void PWNP_BattleResourcesChanged(void* mcss)
{
    for (u32 i = 0; i < ACTOR_COUNT; ++i) {
        ActorState* actor = &sState.actor[i];
        if (actor->active && actor->mcss == mcss) {
            actor->textureDirty = 2;
            actor->paletteDirty = true;
            actor->copiedFrame = 0xffffu;
        }
    }
}''')
    text = replace(text, '''        actorState->pendingFrame = frame;
        actorState->textureDirty = true;''', '''        actorState->pendingFrame = frame;
        if (!actorState->textureDirty) actorState->textureDirty = true;''')
    text = replace(text, '''    if (wasInactive || mcssIndexChanged || mcssPointerChanged || speciesChanged) {
        actorState->paletteDirty = true;
    }''', '''    if (wasInactive || mcssIndexChanged || mcssPointerChanged || speciesChanged) {
        actorState->paletteDirty = true;
        actorState->textureDirty = 2;
    }''')
    text = replace(text, '    actorState->textureDirty = true;', '    if (!actorState->textureDirty) actorState->textureDirty = true;', 4)
    text = replace(text, '    b32 stagedTexture = true;', '    const b32 refreshAgain = actorState->textureDirty == 2;\n    b32 stagedTexture = true;')
    text = replace(text, '            actorState->copiedFrame = actorState->pendingFrame;', '            actorState->copiedFrame = refreshAgain ? 0xffffu : actorState->pendingFrame;')
    text = replace(text, 'extern "C" void W2U_BattleAnim_Term(void)\n{', 'extern "C" void W2U_BattleAnim_Term(void)\n{\n    PWNP_BattleTerm();')
    return text

def adapt_summary(text):
    text = '#include "runtime.h"\n' + text
    text = replace(text, '    b32 shiny;\n', '    b32 shiny;\n    u32 nature;')
    text = replace(text, '    u32 observedAsset;', '    u32 observedAsset;\n    u32 observedNature;\n    u32 observedShiny;')
    text = replace(text, '           sState.observedForm == identity.form &&', '           sState.observedForm == identity.form &&\n           sState.observedNature == identity.nature &&\n           sState.observedShiny == (u32)identity.shiny &&')
    text = replace(text, '    sState.observedForm = identity.form;', '    sState.observedForm = identity.form;\n    sState.observedNature = identity.nature;\n    sState.observedShiny = identity.shiny;')
    text = replace(text, '    SummaryPokemonIdentity identity = {SPECIES_NONE, 0, false};', '    SummaryPokemonIdentity identity = {SPECIES_NONE, 0, false, 255};')
    text = replace(text, '    identity.species = (u16)PP_Get_Fn(pp, W2U_PKM_PARAM_SPECIES, 0);', '    identity.nature = nature_palettes::ppNature(pp);\n    identity.species = (u16)PP_Get_Fn(pp, W2U_PKM_PARAM_SPECIES, 0);')
    text = replace(text, 'static void CopyPalette(SummaryAssetId assetId)', 'static void CopyPalette(SummaryAssetId assetId, SummaryPokemonIdentity identity, bool front)')
    text = replace(text, '''    for (u32 i = 0; i < 16; ++i) {
        W2U_OBJ_PLTT[W2U_OBJ_PLT * 16 + i] = asset->palette[i];
    }
''', '')
    text = replace(text, '    sState.paletteAsset = assetId;', '''    np_u16 colors[16];
    for (u32 i = 0; i < 16; ++i) colors[i] = asset->palette[i];
    if (identity.nature < 25) nature_palettes::apply(colors, nature_palettes::key(nature_palettes::sprite(identity.species, identity.form), front ? 1 : 2, identity.nature, identity.shiny));
    for (u32 i = 0; i < 16; ++i) W2U_OBJ_PLTT[W2U_OBJ_PLT * 16 + i] = colors[i];
    sState.paletteAsset = assetId;''')
    text = replace(text, '        CopyPalette(assetId);', '        CopyPalette(assetId, identity, sub->isDispFront);')
    return text

def black2(text, scene):
    pairs = [('0x021F4280', '0x021F4240'), ('0x021E97D5', '0x021E9795'), ('0x021E7FBD', '0x021E7F7D')] if scene == 'battle' else [
        ('0x021B4DDD', '0x021B4D9D'), ('0x0201CDB5', '0x0201CD89'), ('0x0201ADA9', '0x0201AD7D'), ('0x0201ADB9', '0x0201AD8D'), ('0x0201AEF9', '0x0201AECD')]
    for a,b in pairs: text = text.replace(a,b)
    return text

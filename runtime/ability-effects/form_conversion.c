/* The retail move-param record is copied for previews, spread moves and
 * individual strikes. Its upper flags carry the successful conversion with it.
 * Retail uses the low flags in both games (deferred use / replacement). */
enum { MOVE_PARAM_FLAGS = 16, CONVERSION_TYPE_SHIFT = 8, CONVERSION_RATIO_SHIFT = 16 };
PUBLIC const volatile u32 AbilityFormConversionApi[4] = {0};
#ifdef ABILITY_FORM_CONVERSION_TEST
typedef struct { u8 event, user, target, type; u16 move, form; u32 value; } FormConversionTestEntry;
PUBLIC volatile struct { u32 tag, count; FormConversionTestEntry rows[48]; } AbilityFormConversionTest = {0x54434d46, 0, {{0}}};
static void formConversionLog(u8 event,u8 user,u8 target,u8 type,u16 move,u16 form,u32 value){
    u32 n=AbilityFormConversionTest.count;
    if(n<48){AbilityFormConversionTest.rows[n]=(FormConversionTestEntry){event,user,target,type,move,form,value};AbilityFormConversionTest.count=n+1;}
}
#endif

static u32 moveConversion, powerConversion;

PUBLIC u16 AbilityRecipePower(void *flow, void *attacker, void *defender, const u8 *param) {
    u32 saved = powerConversion;
    u32 flags = *(const u32 *)(param + MOVE_PARAM_FLAGS);
    powerConversion = (flags >> CONVERSION_TYPE_SHIFT & 31) == param[6] && half(param) == half(param + 2)
        ? flags >> CONVERSION_RATIO_SHIFT : 0;
    u16 result = ((u16 (*)(void *, void *, void *, const u8 *))(uintptr_t)AbilityFormConversionApi[0])
        (flow, attacker, defender, param);
    powerConversion = saved;
    return result;
}

static void zenMode(void *flow, u8 owner, const volatile u8 *effect, u32 event, u32 *work, u32 activeRule) {
    if (event != 0x55 && event != 0x78 && event != 0x6a && event != 0x89) return;
    if (event != 0x78 && VALUE(2) != owner) return;
    if (preview(flow)) return;
    if (event == 0x55) { work[0] = 0; return; }

    void *mon = MON(flow, owner);
    u32 species = effect[1] | (u32)effect[4] << 8;
    if (FN(29,u32(*)(void*))(mon) != species || !STAT(mon,13)) return;
    u32 form = STAT(mon,0x13), source = effect[5], target = effect[6];
    u32 destination;
    if (event == 0x78 && activeRule && form == source
        && STAT(mon,13) * 100 <= STAT(mon,14) * half(effect + 2)) {
        u32 count = ((u32 (*)(u16,u16,u32))(uintptr_t)AbilityFormConversionApi[1])(species,0,32);
        if (target >= count || source >= count) return;
        destination = target;
    } else if (work[0] && form == target && (event != 0x78 || !activeRule
        || STAT(mon,13) * 100 > STAT(mon,14) * half(effect + 2))) {
        destination = source;
    } else return;

    // The native command mutates the backing party record to load the form's
    // stats. Keep its original ability so leaving battle cannot carry over
    // an ability from the temporary form.
    void *party = *(void **)mon;
    u32 (*getParty)(void *, u32, void *) = (void *)(uintptr_t)AbilityFormConversionApi[2];
    void (*setParty)(void *, u32, u32) = (void *)(uintptr_t)AbilityFormConversionApi[3];
    u32 partyAbility = getParty(party,10,0);
    u16 *battleAbility = (u16 *)((u8 *)mon + 0x13c);
    u16 currentAbility = *battleAbility;
    u8 *formFlags = (u8 *)mon + 0x1b;
    u8 baseForm = *formFlags & 31;
    u8 *command = PUSH(flow,0x39,owner);
    if (event == 0x78) command[2] |= 0x80; // Native form-change ability popup.
    command[4] = owner;
    command[5] = destination;
    u16 message = destination == target ? 0xb9 : 0xba;
    u32 argument = owner;
#ifdef ABILITY_ZEN_MODE_MESSAGES
    u16 custom = AbilityPresentationMessages[34];
    if (custom) {
        message = custom + (destination == source);
        argument = currentAbility;
    }
#endif
    FN(11,void(*)(void*,u8,u16))(command + 8,1,message);
    FN(12,void(*)(void*,u32))(command + 8,argument);
    POP(flow,command);
    if (STAT(mon,0x13) == destination) {
#if defined(ABILITY_FORM_CONVERSION_TEST) && defined(ABILITY_ZEN_MODE_MESSAGES)
        formConversionLog(0xfa,owner,0,0,message,destination,argument);
#endif
        work[0] = destination == target;
        setParty(party,10,partyAbility);
        *battleAbility = currentAbility;
        *formFlags = (*formFlags & ~31) | baseForm;
    }
}

// Read-only BW2 client-state evaluation. Never call server event handlers.
// Native addresses/condition layouts are checked independently for IREO/IRDO.
namespace {
unsigned abilityOf(void* mon) {
    return ram(mon)?reinterpret_cast<unsigned(*)(void*,unsigned)>(NativeBattleStat)(mon,17):0;
}
bool sick(void* mon,unsigned id) {
    return reinterpret_cast<unsigned(*)(void*,unsigned)>(NativeCheckSick)(mon,id)!=0;
}
void* moveAttacker(void* biw) {
    if(field<u32>(biw,0x50)==3) {
        const unsigned slot=(field<u32>(biw,0x68)>>19)&3;
        return slot<3?field<void*>(biw,0x330+slot*4):nullptr;
    }
    return moveTarget(gBattleMoveHud.selectedSlot>>2);
}
int affinityPart(unsigned type,unsigned defendType,unsigned reveal,bool scrappy,bool flatGround) {
    unsigned aff=reinterpret_cast<unsigned(*)(unsigned,unsigned)>(NativeTypeAffinity)(type,(defendType<<8)|defendType);
    // Foresight/Odor Sleuth/Miracle Eye are native continuation records.
    const unsigned form=reveal&7;
    const unsigned shift=form==4?15:9;
    const bool match=form && ((reveal>>shift)&0xffff)==defendType;
    const bool master=match&&((reveal>>(shift+16))&1);
    if(master || (aff==0&&(match||(scrappy&&defendType==7)||flatGround))) aff=3;
    return aff==0?-8:static_cast<int>(aff)-3;
}
// -8 immune, -2/-1 resisted, 0 neutral, +1/+2 super effective, 8 unknown.
int moveAffinity(void* biw,unsigned move,unsigned attr,void* target,u16 pair) {
    void* attacker=moveAttacker(biw);
    if(!ram(attacker)) return 8;
    const unsigned atkAbility=abilityOf(attacker), defAbility=abilityOf(target);
    // Custom abilities require an explicit mechanics profile.
    if(atkAbility>164||defAbility>164) return 8;
    void* main=reinterpret_cast<void*(*)()>(NativeGetMainModule)();
    if(!ram(main)) return 8;
    void* fld=reinterpret_cast<void*(*)(void*)>(NativeFieldSim)(main);
    if(!ram(fld)) return 8;
    auto fieldOn=reinterpret_cast<unsigned(*)(void*,unsigned)>(NativeFieldEffect);
    const bool gravity=fieldOn(fld,2)!=0, magicRoom=fieldOn(fld,7)!=0;
    const unsigned item=reinterpret_cast<unsigned(*)(void*)>(NativeHeldItem)(target);
    const bool itemActive=!magicRoom&&!sick(target,19)&&defAbility!=103;
    const bool rooted=sick(target,21), smacked=sick(target,31);
    const bool grounded=gravity||rooted||smacked||(itemActive&&item==278);
    const bool bypass=atkAbility==104||atkAbility==163||atkAbility==164;
    const unsigned defense=bypass?0:defAbility;
    const unsigned type=attr&31;
    const unsigned reveal=reinterpret_cast<unsigned(*)(void*,unsigned)>(NativeSickCont)(target,17);
    int a=affinityPart(type,pair>>8,reveal,atkAbility==113,type==4&&(gravity||rooted||smacked));
    int b=(pair>>8)==(pair&255)?0:affinityPart(type,pair&255,reveal,atkAbility==113,type==4&&(gravity||rooted||smacked));
    int aff=(a==-8||b==-8)?-8:a+b;
    if(type==4) {
        // Retail BW2: Iron Ball resolves a remaining Flying type immunity to
        // neutral overall. Gravity/Ingrain/Smack Down flatten it per type first.
        if(aff==-8&&grounded) aff=0;
        if(!grounded&&(defense==26||(itemActive&&item==541)||sick(target,30)||sick(target,32))) return -8;
    }
    if(aff==-8) return -8;
    if((type==10&&(defense==11||defense==87||defense==114))
       ||(type==12&&(defense==10||defense==31||defense==78))
       ||(type==9&&defense==18)||(type==11&&defense==157)
       ||(defense==43&&(attr&32))||(defense==25&&aff<=0)) return -8;
    // Sturdy blocks one-hit KO moves even when HP is already below maximum.
    if(defense==5&&(move==12||move==32||move==90||move==329)) return -8;
    return aff;
}
}

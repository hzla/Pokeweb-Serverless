// Included inside the shared renderer's private namespace in BW2 builds.
void animatePokenav(){
    using namespace pokenav::ui;
    if(!state->chain.count)return;
    const u32 i=state->chain.selected,slot=state->iconSlots[i];if(!state->iconsValid[slot])return;
    const int x=184-int(state->chain.count*44-12)/2+int(i)*44;auto s=edit(state->work,0);
    rect(s,x,48,32,32,Selected);const auto& id=state->iconKeys[slot];
    const u32 bank=native<u32(*)(u32,u32,u32,u32)>(0x2021061,0x2021035)(id.species,id.form,id.gender,0);
    icon(s,state->icons[slot]+state->iconFrame*512,u8(bank),x,48);commit(s);
}
void pokenavBase(pokenav::ui::Surface& s,bool land){
    using namespace pokenav::ui;const u8 accent=land?Grass:Water;
    plate(s,4,3,203,24);plate(s,211,3,40,24,Header);rect(s,217,4,27,1,accent);
    plate(s,4,41,106,92);flap(s,4,28,106,"Base stats",accent);rect(s,7,44,100,1,accent);
    plate(s,116,41,135,92);flap(s,116,28,135,"Family / Abilities",accent);rect(s,119,44,129,1,accent);
    rect(s,119,83,129,1,InactiveEdge);plate(s,4,150,247,40);
    const Point rim[]={{4,142},{10,136},{191,136},{199,144},{251,144},{251,153},{4,153}};
    const Point face[]={{5,142},{11,137},{190,137},{198,145},{250,145},{250,153},{5,153}};
    polygon(s,rim,7,Bevel);polygon(s,face,7,Header);rect(s,11,137,177,1,accent);rect(s,7,153,239,1,accent);
}
__attribute__((optimize("O2"))) void renderPokenav(){
    using namespace pokenav::ui;
    auto s=begin(state->work,bmp(),0);const u8 accent=state->context.land?Grass:Water;
    u16 value[128];
    const bool land=state->context.land;
    if(needsBase(!land)){pokenavBase(s,!land);saveBase(s,!land);s=begin(state->work,bmp(),0);}
    if(!restoreBase(s,land)){pokenavBase(s,land);saveBase(s,land);}
    if(customRegions&1){copyText(value,128,state->title);infoTitleCase(value);fit(s,value,122);text(s,value,11,7,SummaryWhite);}
    if(customRegions&1){number(value,state->context.chance);u32 n=0;while(value[n]!=End)++n;value[n++]='%';value[n]=End;text(s,value,231-int(measure(s,value))/2,7,SummaryWhite);}
    if((customRegions&2)&&state->statsValid)for(u32 i=0;i<6;++i){
        const int y=46+int(i)*14;smallText(s,state->labels[i],11,y+3);number(value,state->stats[i]);text(s,value,55-int(measure(s,value)),y,SummaryWhite);
        rect(s,61,y+5,40,7,Track);const u32 size=statBar(state->stats[i],40);rect(s,61,y+5,int(size),7,accent);rect(s,61,y+5,int(size),2,state->context.land?GrassLight:WaterLight);
    }else if(customRegions&2){copyText(value,128,state->statsUnavailable);fit(s,value,92);text(s,value,11,65,MutedText);}
    if(customRegions&4)for(u32 i=0;i<state->chain.count;++i){
        const u32 slot=state->iconSlots[i];const int x=184-int(state->chain.count*44-12)/2+int(i)*44;
        if(i==state->chain.selected){rect(s,x-2,47,36,34,Selected);outline(s,x-2,47,36,34,accent);}
        if(state->iconsValid[slot]){
            const auto& id=state->iconKeys[slot];const u32 bank=native<u32(*)(u32,u32,u32,u32)>(0x2021061,0x2021035)(id.species,id.form,id.gender,0);
            icon(s,state->icons[slot]+(i==state->chain.selected?state->iconFrame*512:0),u8(bank),x,48);
        }else label(s,"?",x+12,56);
        if(i+1<state->chain.count){const u16 arrow[]={0x2192,End};text(s,arrow,x+34,55,MutedText);}
    }
    const u32 count=state->abilities.count?state->abilities.count:1;
    if(customRegions&8)for(u32 i=0;i<count;++i){
        const int y=85+int(i)*16;rect(s,119,y+1,129,14,Plate);rect(s,119,y+2,2,12,state->abilities.hidden[i]?Hidden:Ability);
        copyText(value,128,state->abilityNames[i]);if(state->abilities.count)infoTitleCase(value);fit(s,value,120);text(s,value,124,y,state->abilities.hidden[i]?HiddenText:SummaryWhite);
        if(i+1<count)rect(s,122,y+15,124,1,InactiveEdge);
    }
    if((customRegions&16)&&state->pageCount){
        const auto& p=state->pages[state->page];
        if(p.incoming)copyText(value,128,state->status);
        else {u32 n=copyText(value,128,state->selectedName);value[n++]=' ';value[n++]=0x2192;value[n++]=' ';copyText(value+n,128-n,state->targets[p.option]);}
        fit(s,value,state->pageCount>1?194:232);text(s,value,11,139,SummaryWhite);
        if(state->pageCount>1){asciiText(value,128,"A ");u32 n=2;n+=decimal(value+n,state->page+1);value[n++]='/';n+=decimal(value+n,state->pageCount);value[n]=End;text(s,value,244-int(measure(s,value)),139,MutedText);}
        u32 offset=p.offset;for(u32 row=0;row<2;++row){offset=wrapInfo(state->requirements[p.option],offset,value,128,240,[](const u16* p){return measure(p);});text(s,value,8,157+int(row)*16,BodyText);}
    }else if(customRegions&16){
        smallLabel(s,"Evolution",11,142);u32 offset=0;for(u32 row=0;row<2;++row){offset=wrapInfo(state->status,offset,value,128,240,[](const u16* p){return measure(p);});text(s,value,8,157+int(row)*16,BodyText);}
    }
    finish(s);
}

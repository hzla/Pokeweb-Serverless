#pragma once
#include <stdint.h>
namespace pokenav {
using u8=uint8_t;using u16=uint16_t;using u32=uint32_t;
constexpr u32 Magic=0x56414e50;
constexpr u16 Abi=2;
struct Launch {
    u32 magic=Magic;u16 version=Abi,size=sizeof(Launch);
    u16 zone=0,placeName=0;u8 started=0,finished=0,valid=0,reserved=0;
    u8 tables[232]={};
    u8 dupes[7]={};
};
static_assert(sizeof(Launch)==256,"Pokenav field/application ABI");
inline bool validLaunch(const Launch* r){return r&&r->magic==Magic&&((r->version==Abi&&r->size==sizeof(Launch))||(r->version==1&&r->size==248));}
struct Entry {u16 species=0,form=0;u8 chance=0;bool dupe=false;};
struct Table {Entry entries[12]={};u8 count=0,selected=0;};
inline u8 columnOf(u8 index,u8 columns){while(index>=columns)index-=columns;return index;}
struct State {
    Table tables[7]={};u8 water=3,land=0,section=1,column=0;bool header=false;
    Table& table(){return tables[section?land:water];}
    const Table& table()const{return tables[section?land:water];}
    const Entry* entry()const{const auto& t=table();return t.count?&t.entries[t.selected]:nullptr;}
    bool switchMethod(bool forward) {
        u8& current=section?land:water;const int first=section?0:3,last=section?2:6;
        for(int i=int(current)+(forward?1:-1);i>=first&&i<=last;i+=forward?1:-1)
            if(tables[i].count){current=u8(i);column=columnOf(table().selected,section?6:5);return true;}
        return false;
    }
    bool horizontal(bool forward) {
        if(header)return switchMethod(forward);
        auto& t=table();if(!t.count)return false;
        const u8 columns=section?6:5,pos=columnOf(t.selected,columns);
        if(forward?(pos+1>=columns||t.selected+1>=t.count):pos==0)return false;
        t.selected=u8(t.selected+(forward?1:-1));column=columnOf(t.selected,columns);return true;
    }
    bool vertical(bool down) {
        auto& t=table();const u8 columns=section?6:5;
        if(header) {
            if(down&&t.count){header=false;t.selected=column<t.count?column:u8(t.count-1);return true;}
            if(!down&&section){section=0;auto& w=table();header=!w.count;if(w.count)w.selected=column<w.count?column:u8(w.count-1);return true;}
            if(down&&!section){section=1;return true;}
            return false;
        }
        if(down) {
            if(section&&t.selected<columns&&t.count>columns){const u8 next=u8(columns+column);t.selected=next<t.count?next:u8(t.count-1);return true;}
            if(!section){section=1;header=true;return true;}
            return false;
        }
        if(t.selected>=columns){t.selected=column<t.count?column:u8(t.count-1);return true;}
        header=true;return true;
    }
    void select(u8 which,u8 index){section=which;header=false;auto& t=table();if(index<t.count){t.selected=index;column=columnOf(index,which?6:5);}}
};
inline u16 read16(const u8* p){return u16(p[0]|u16(p[1])<<8);}
inline State decode(const u8* bytes,bool valid=true,const u8* dupes=nullptr,bool preventAll=false) {
    State s;
    constexpr u8 grass[]={20,20,10,10,10,10,5,5,4,4,1,1},water[]={60,30,5,4,1},rod[]={40,40,15,4,1};
    if(valid&&bytes)for(u32 method=0;method<7;++method) {
        if(!bytes[method])continue;
        const u32 count=method<3?12:5,offset=method<3?8+method*48:152+(method-3)*20;
        auto& table=s.tables[method];
        for(u32 slot=0;slot<count;++slot) {
            const u16 packed=read16(bytes+offset+slot*4),species=packed&2047,form=packed>>11;
            if(!species)continue;
            u32 i=0;while(i<table.count&&(table.entries[i].species!=species||table.entries[i].form!=form))++i;
            if(i==table.count){table.entries[i]={species,form,0};++table.count;}
            table.entries[i].chance+=method<3?grass[slot]:method<5?water[slot]:rod[slot];
            const u32 physical=method<3?method*12+slot:36+(method-3)*5+slot;
            if(dupes&&(dupes[physical>>3]&(1u<<(physical&7))))table.entries[i].dupe=true;
        }
        if(dupes){u32 total=0;for(u32 i=0;i<table.count;++i)if(!table.entries[i].dupe)total+=table.entries[i].chance;
            if(total||preventAll)for(u32 i=0;i<table.count;++i){auto& e=table.entries[i];if(e.dupe||!total)e.chance=0;
                else{u32 scaled=u32(e.chance)*100+total/2;e.chance=0;while(scaled>=total){scaled-=total;++e.chance;}}
            }
        }
    }
    for(u8 i=0;i<3;++i)if(s.tables[i].count){s.land=i;break;}
    for(u8 i=3;i<7;++i)if(s.tables[i].count){s.water=i;break;}
    if(!s.tables[s.land].count)s.section=0;
    s.header=!s.table().count;return s;
}
}

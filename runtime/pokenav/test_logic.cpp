#include "logic.h"
#include <cassert>
#include <cstdio>
using namespace pokenav;
void slot(u8* bytes,u32 method,u32 index,u16 species,u16 form=0){const u32 offset=(method<3?8+method*48:152+(method-3)*20)+index*4;u16 packed=u16(species|(form<<11));bytes[offset]=u8(packed);bytes[offset+1]=u8(packed>>8);bytes[offset+2]=5;bytes[offset+3]=9;}
int main(){
    u8 bytes[232]={};auto empty=decode(bytes);assert(empty.header&&!empty.entry());assert(!empty.horizontal(true));assert(empty.vertical(true)&&empty.section==1);assert(empty.vertical(false)&&empty.section==0);
    bytes[0]=10;bytes[3]=10;for(u32 i=0;i<12;++i)slot(bytes,0,i,25);for(u32 i=0;i<5;++i)slot(bytes,3,i,129);
    auto s=decode(bytes);assert(s.section==1&&!s.header&&s.land==0&&s.water==3);assert(s.table().count==1&&s.entry()->chance==100);assert(s.tables[3].entries[0].chance==100);
    slot(bytes,0,11,133);slot(bytes,0,10,25,1);s=decode(bytes);assert(s.table().count==3);assert(s.table().entries[0].chance==98&&s.table().entries[1].form==1&&s.table().entries[1].chance==1&&s.table().entries[2].species==133&&s.table().entries[2].chance==1);
    slot(bytes,3,0,118);slot(bytes,3,1,118);s=decode(bytes);assert(s.tables[3].count==2&&s.tables[3].entries[0].chance==90&&s.tables[3].entries[1].chance==10);
    bytes[2]=1;slot(bytes,2,0,531);bytes[6]=1;slot(bytes,6,4,350);s=decode(bytes);s.header=true;
    assert(!s.horizontal(false));assert(s.horizontal(true)&&s.land==2);assert(!s.horizontal(true));assert(s.horizontal(false)&&s.land==0);
    s.section=0;assert(s.horizontal(true)&&s.water==6);assert(!s.horizontal(true));assert(s.horizontal(false)&&s.water==3);
    s.select(1,2);assert(s.vertical(false)&&s.header);assert(s.vertical(true)&&!s.header&&s.table().selected==2);
    for(u32 i=0;i<12;++i)slot(bytes,0,i,u16(1+i));s=decode(bytes);assert(s.table().count==12);s.select(1,5);assert(!s.horizontal(true));assert(s.vertical(true)&&s.table().selected==11);assert(!s.vertical(true));assert(s.vertical(false)&&s.table().selected==5);
    s.select(1,11);assert(s.switchMethod(true)&&s.land==2&&!s.header&&s.column==0);assert(!s.switchMethod(true));
    assert(s.switchMethod(false)&&s.land==0&&s.table().selected==11&&s.column==5);assert(!s.switchMethod(false));
    assert(s.vertical(false)&&s.table().selected==5);
    for(u32 i=7;i<12;++i)slot(bytes,0,i,0);s=decode(bytes);s.select(1,5);assert(s.vertical(true)&&s.table().selected==6);assert(s.vertical(false)&&s.table().selected==5);
    s.select(0,1);assert(s.vertical(true)&&s.section==1&&s.header);assert(s.vertical(false)&&s.section==0&&!s.header&&s.table().selected==1);
    bytes[0]=0;bytes[3]=0;s=decode(bytes);assert(s.land==2&&s.water==6);assert(s.entry()->species==531);
    s=decode(bytes,false);assert(!s.entry()&&s.header);
    // ABI 2 carries a physical-slot exclusion snapshot; ABI 1 stays readable.
    Launch request;assert(validLaunch(&request));request.version=1;request.size=248;assert(validLaunch(&request));request.size=256;assert(!validLaunch(&request));
    u8 filtered[232]={},dupes[7]={};filtered[0]=filtered[5]=10;
    for(u32 i=0;i<12;++i)slot(filtered,0,i,i<3?2:6);
    dupes[0]=7;s=decode(filtered,true,dupes,true);
    assert(s.tables[0].count==2&&s.tables[0].entries[0].dupe&&s.tables[0].entries[0].chance==0);
    assert(!s.tables[0].entries[1].dupe&&s.tables[0].entries[1].chance==100);
    s.select(1,0);assert(s.entry()->species==2&&s.entry()->dupe); // Dupe previews remain selectable.
    dupes[0]=255;dupes[1]=15;s=decode(filtered,true,dupes,true);
    assert(s.tables[0].entries[0].chance==0&&s.tables[0].entries[1].chance==0);
    s=decode(filtered,true,dupes,false);assert(s.tables[0].entries[0].chance==50&&s.tables[0].entries[1].chance==50);
    for(u32 i=0;i<5;++i)slot(filtered,5,i,u16(100+i));s=decode(filtered);
    assert(s.tables[5].entries[0].chance==40&&s.tables[5].entries[1].chance==40&&s.tables[5].entries[2].chance==15&&s.tables[5].entries[4].chance==1);
    std::puts("Pokenav grouping, forms, exact chances, defaults, missing methods, navigation and empty data passed");
}

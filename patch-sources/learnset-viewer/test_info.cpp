#include "info_logic.h"
#include <cassert>
#include <cstring>
#include <vector>
using namespace learnset;
int main() {
    {
        InfoNode family[32]={};Evolutions options[32]={};
        for(u16 i=1;i<32;++i){family[i]={i,0,0,0,true,true};options[i].valid=true;}
        auto link=[&](u16 a,u16 b){
            options[a].entries[options[a].count++]={4,20,b};
            if(!family[a].next)family[a].next=b;
            if(!family[b].parent)family[b].parent=a;
        };
        u32 reads=0;
        auto read=[&](u16 i){assert(i<32);++reads;return options[i];};
        auto step=[&](u16 from,bool right,u16 target,u16 parent){
            reads=0;auto result=familyStep(family,32,from,right,read);
            assert(result.target==target && result.parent==parent && reads<=33);
        };
        link(1,2);link(2,3);
        step(2,false,1,0);step(1,true,2,1);step(2,true,3,2);step(3,false,2,1);step(3,true,0,0);
        link(4,5);link(4,5);link(4,6);link(4,7);
        step(4,true,5,4);step(5,true,6,4);step(6,true,7,4);step(7,false,6,4);step(6,false,5,4);step(5,false,4,0);step(7,true,0,0);
        link(8,9);link(8,11);link(9,10);link(11,12);
        step(9,true,10,9);step(10,true,11,8);step(11,false,9,8);step(11,true,12,11);step(12,true,0,0);
        link(13,13);step(13,true,0,0);step(13,false,0,0);
        link(14,15);link(15,16);link(16,14);step(14,true,15,14);step(16,true,14,16);
        // Corrupt/repeated parent chains cannot spin while searching for a sibling.
        family[17].parent=18;family[18].parent=17;step(17,true,0,0);
        family[19].parent=31;family[31].valid=false;step(19,false,0,0);
        family[21].species=20;family[21].form=1;link(22,20);link(22,21);
        step(20,true,21,22);step(21,false,20,22);
        options[22].valid=false;step(20,true,0,0);
        assert(!familyStep(family,32,32,true,read).target);
        assert(!familyStep(family,MaxPersonal+1,1,true,read).target);
    }
    u8 slots[]={8,8,24};Abilities abilities=infoAbilities(slots);
    assert(abilities.count==2 && abilities.ids[0]==8 && abilities.ids[1]==24);
    assert(!abilities.hidden[0] && abilities.hidden[1]);
    slots[0]=0;slots[1]=0;slots[2]=0;assert(!infoAbilities(slots).count);
    slots[0]=8;slots[1]=24;slots[2]=8;abilities=infoAbilities(slots);
    assert(abilities.count==2 && abilities.hidden[0] && !abilities.hidden[1]);
    slots[0]=1;slots[1]=2;slots[2]=255;abilities=infoAbilities(slots);
    assert(abilities.count==3 && abilities.ids[2]==255 && abilities.hidden[2]);
    InfoNode nodes[32]={};for(u16 i=1;i<32;++i)nodes[i]={i,0,0,0,true,true};
    auto edge=[&](u16 a,u16 b){if(!nodes[a].next)nodes[a].next=b;if(!nodes[b].parent)nodes[b].parent=a;};
    auto check=[&](u16 chosen,std::initializer_list<u16> expected){
        Chain c=infoChain(nodes,32,chosen);assert(c.count<=3 && c.count==expected.size());
        assert(c.ids[c.selected]==chosen);u32 i=0;for(u16 id:expected)assert(c.ids[i++]==id);
        for(i=0;i<c.count;++i)for(u32 j=0;j<i;++j)assert(!sameNode(nodes,c.ids[i],c.ids[j]));
    };
    edge(1,2);edge(2,3);edge(3,4);edge(4,2);
    check(1,{1,2,3});check(2,{1,2,3});check(3,{2,3,4});check(4,{3,4,2});
    edge(5,5);check(5,{5});edge(6,7);edge(7,6);check(6,{7,6});check(7,{6,7});
    assert(!infoChain(nodes,32,5).before && !infoChain(nodes,32,5).after);
    assert(!infoChain(nodes,32,6).before && !infoChain(nodes,32,6).after);
    assert(infoChain(nodes,32,1).after && infoChain(nodes,32,3).before);
    assert(!infoChain(nodes,32,3).after);
    edge(8,9);edge(9,10);check(8,{8,9,10});check(9,{8,9,10});check(10,{8,9,10});
    check(11,{11});edge(12,13);edge(12,14);check(12,{12,13});check(14,{12,14});
    nodes[16].valid=false;nodes[15].next=16;check(15,{15});
    edge(18,19);edge(18,20);edge(20,21);edge(21,22);
    Chain branch=infoChain(nodes,32,18,20);
    assert(branch.count==3 && branch.ids[0]==18 && branch.ids[1]==20 && branch.ids[2]==21 && branch.after);
    branch=infoChain(nodes,32,19,20);
    assert(branch.count==3 && branch.ids[0]==18 && branch.ids[1]==19 && branch.ids[2]==20 && branch.selected==1);
    branch=infoChain(nodes,32,19,18); // The branch target is already the predecessor.
    assert(branch.count==2 && branch.ids[0]==18 && branch.ids[1]==19 && !branch.after);
    branch=infoChain(nodes,32,18,18);assert(branch.count==1 && !branch.after);
    branch=infoChain(nodes,32,18,16);assert(branch.count==1 && !branch.after);
    assert(!infoChain(nodes,32,0).count && !infoChain(nodes,32,32).count);
    for(u32 selected=1;selected<32;++selected) {
        for(u32 i=1;i<32;++i){nodes[i].valid=true;nodes[i].next=i==31?1:i+1;nodes[i].parent=i==1?31:i-1;}
        Chain c=infoChain(nodes,32,selected);assert(c.count==3 && c.ids[c.selected]==selected);
        for(u16 target=0;target<32;++target) {
            c=infoChain(nodes,32,selected,target);assert(c.count<=3 && c.ids[c.selected]==selected);
            for(u32 i=0;i<c.count;++i)for(u32 j=0;j<i;++j)assert(!sameNode(nodes,c.ids[i],c.ids[j]));
        }
    }
    u8 bytes[48]={};auto slot=[&](u32 i,u16 method,u16 param,u16 target){
        u16 values[]={method,param,target};for(u32 n=0;n<3;++n){bytes[6*i+2*n]=values[n]&255;bytes[6*i+2*n+1]=values[n]>>8;}
    };
    assert(parseEvolutions(bytes,42,32).valid && parseEvolutions(bytes,48,32).valid);
    slot(0,999,123,1);slot(7,8,80,2);
    assert(parseEvolutions(bytes,42,32).count==1 && parseEvolutions(bytes,48,32).count==2);
    assert(parseEvolutions(bytes,48,32).entries[0].method==999);
    for(u32 bad:{0u,1u,41u,43u,47u,49u})assert(!parseEvolutions(bytes,bad,32).valid);
    slot(0,1,1,32);assert(!parseEvolutions(bytes,48,32).valid);
    slot(0,1,1,0);assert(!parseEvolutions(bytes,48,32).valid);
    for(u32 v=0;v<256;++v){assert(statBar(v)<=46);if(v)assert(statBar(v)>=statBar(v-1));}
    assert(statBar(0)==0 && statBar(255)==46 && statBar(100)==18);
    assert(infoUpper('a')=='A' && infoUpper(0xe9)==0xc9 && infoUpper(0xf7)==0xf7 && infoUpper(0x2640)==0x2640);
    u16 format[80],out[256],a[32],b[32];
    asciiText(out,256,"POISON POINT / SOUL-HEART / KING'S TEST / #229");
    infoTitleCase(out);u16 titleExpected[80];
    asciiText(titleExpected,80,"Poison Point / Soul-Heart / King's Test / #229");
    for(u32 i=0;titleExpected[i]!=End;++i)assert(out[i]==titleExpected[i]);
    out[0]=0xe9;out[1]='C';out[2]='L';out[3]=End;infoTitleCase(out);
    assert(out[0]==0xc9 && out[1]=='c' && out[2]=='l' && out[3]==End);
    asciiText(format,80,"Method {0}, parameter {1}.");asciiText(a,32,"999");asciiText(b,32,"123");
    expandInfo(out,256,format,a,b);u16 expected[80];asciiText(expected,80,"Method 999, parameter 123.");
    assert(!std::memcmp(out,expected,50));
    asciiText(out,256,"A long evolution requirement that must wrap without losing any words.");
    auto measure=[](const u16* t){u32 n=0;while(*t && *t++!=End)++n;return n*6;};
    u32 offset=0,lines=0;u16 line[128];
    while(out[offset]!=End){u32 next=wrapInfo(out,offset,line,128,60,measure);assert(next>offset && measure(line)<=60);offset=next;++lines;assert(lines<30);}
    assert(lines>2);
    std::vector<u8> screen(24576+16,0xa5);infoRect(screen.data(),0,0,256,192,1);
    for(u32 i=0;i<24576;++i)assert(screen[i]==0x11);
    infoPixel(screen.data(),255,191,15);assert(screen[24575]==0xf1);
    infoPixel(screen.data(),256,192,15);for(u32 i=24576;i<screen.size();++i)assert(screen[i]==0xa5);
}

#include "logic.h"
#include <cassert>
#include <cstring>
#include <vector>
using namespace learnset;
static std::vector<u8> records(std::initializer_list<Entry> values, bool terminated=true) {
    std::vector<u8> bytes;
    for(auto e:values) for(auto v:{e.moveId,e.level}) { bytes.push_back(v&255); bytes.push_back(v>>8); }
    if(terminated) for(int i=0;i<4;++i) bytes.push_back(255);
    return bytes;
}
int main() {
    auto bytes=records({{6,55},{8,1},{9,1},{6,55},{6,0},{6,100}});
    auto list=parse(bytes.data(),bytes.size(),1000);
    assert(list.status==Status::Ready && list.count==5);
    const Entry expected[]={{6,0},{8,1},{9,1},{6,55},{6,100}};
    assert(!std::memcmp(expected,list.entries,sizeof(expected)));
    bytes=records({}); assert(parse(bytes.data(),bytes.size(),1000).status==Status::Empty);
    assert(parse(nullptr,0,1000).status==Status::Unavailable);
    for(auto e:{Entry{0,1},Entry{1000,1},Entry{10,101},Entry{End,1}}) {
        bytes=records({e}); assert(parse(bytes.data(),bytes.size(),1000).status==Status::Unavailable);
    }
    bytes=records({{10,1}},false); assert(parse(bytes.data(),bytes.size(),1000).status==Status::Unavailable);
    bytes.push_back(255); assert(parse(bytes.data(),bytes.size(),1000).status==Status::Unavailable);
    bytes.clear();
    for(u16 i=1;i<=32;++i) {auto b=records({{i,u16(33-i)}},false);bytes.insert(bytes.end(),b.begin(),b.end());}
    bytes.insert(bytes.end(),4,255); list=parse(bytes.data(),bytes.size(),1000);
    assert(list.count==32 && list.entries[0].moveId==32 && list.entries[31].moveId==1);
    bytes.insert(bytes.begin(),4,1); assert(parse(bytes.data(),bytes.size(),1000).status==Status::Unavailable);
    // Real NARC block layout, including truncation and overflow attacks.
    std::vector<u8> archive(64,0);
    auto put=[&](u32 offset,u32 value){for(u32 i=0;i<4;++i)archive[offset+i]=value>>(i*8);};
    put(0,0x4352414e);put(4,0x0100fffe);put(8,64);put(12,0x30010);
    put(16,0x46415442);put(20,20);put(24,1);put(28,0);put(32,12);
    put(36,0x464e5442);put(40,8);put(44,0x46494d47);put(48,20);
    put(52,0x00370035);put(56,0x0000000a);put(60,0xffffffff);
    auto read=[&](u32 offset,u8* out,u32 size){assert(offset+size<=archive.size());std::memcpy(out,archive.data()+offset,size);return true;};
    u8 member[132];assert(readMember(64,0,member,132,read)==12);
    assert(parse(member,12,1000).entries[0].moveId==10);
    assert(!readMember(64,1,member,132,read));assert(!readMember(64,0,member,8,read));
    assert(!readMember(63,0,member,132,read));
    assert(!readMember(64,0,member,132,[](u32,u8*,u32){return false;}));
    for(u32 offset:{0u,4u,8u,12u,16u,20u,28u,32u,36u,40u,44u,48u}) {
        auto saved=read32(archive.data()+offset);put(offset,0xffffffff);
        assert(!readMember(64,0,member,132,read));put(offset,saved);
    }
    for(u32 fields=0;fields<=4;++fields) for(u32 extras=0;extras<=2;++extras) {
        u32 menu[]={0,1,3,4,6,16,16,16};
        if(extras>=1){menu[4]=11;menu[5]=6;menu[6]=16;}
        if(extras==2){menu[5]=7;menu[6]=6;menu[7]=16;}
        assert(canAppend(menu,4+fields+extras,true)==(4+fields+extras<8));
        assert(!canAppend(menu,4+fields+extras,false));
    }
    u32 submenu[]={9,10,6,16,16,16,16,16}; assert(!canAppend(submenu,3,true));
    u32 egg[]={0,3,6,16,16,16,16,16}; assert(!canAppend(egg,3,true));
    u16 out[96],name[]={'S','m','o','k','e','S','c','r','e','e','n',End};
    auto measure=[](const u16* s){u32 n=0;while(*s++!=End)++n;return n*6;};
    for(u16 level:{0,1,55,100}) {
        label(out,96,level,name,106,measure);
        assert(measure(out)<=106 && out[0]!=' ');
        label(out,96,level,name,60,measure);
        u32 n=measure(out)/6; assert(n<=10 && out[n-1]=='.' && out[n-2]=='.' && out[n-3]=='.');
    }
    for(u32 n:{0u,1u,10u,55u,100u,1000u,4294967295u}) {
        u32 len=decimal(out,n); u32 actual=0;for(u32 i=0;i<len;++i)actual=actual*10+out[i]-'0';assert(actual==n);
    }
}

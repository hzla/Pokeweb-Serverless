#include "logic.h"
#include <cassert>
#include <cstdio>
using namespace nuzlocke;
int main(){
    u16 parents[32];for(u32 i=0;i<32;++i)parents[i]=u16(i);
    join(parents,1,2);join(parents,2,3);join(parents,2,4);join(parents,4,1);
    assert(root(parents,1)==root(parents,3)&&root(parents,1)==root(parents,4)&&root(parents,1)!=root(parents,5));
    const u8 weights[]={20,20,10,10,10,10,5,5,4,4,1,1};
    for(u16 mask=0;mask<4096;++mask){
        const auto total=mass(weights,mask,12);u32 counts[12]={};
        for(u32 roll=0;roll<total;++roll){const auto slot=pick(weights,mask,12,roll);assert(slot<12&&!(mask&(1u<<slot)));++counts[slot];}
        for(u32 i=0;i<12;++i)assert(counts[i]==((mask&(1u<<i))?0:weights[i]));
    }
    assert(mass(nullptr,0b10101,5)==2&&pick(nullptr,0b10101,5,0)==1&&pick(nullptr,0b10101,5,1)==3);
    assert(mass(weights,4095,12)==0&&pick(weights,4095,12,0)==12);
    std::puts("Nuzlocke family cycles/branches and all 4,096 weighted exclusion masks passed");
}

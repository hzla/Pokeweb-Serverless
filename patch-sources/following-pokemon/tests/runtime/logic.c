#include "../following.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static FwSample sample(int x, int y, int z, unsigned gen, unsigned kind) {
    FwSample s = {0}; s.x=x;s.y=y;s.z=z;s.generation=gen;s.kind=kind;s.connection=0xffff;return s;
}
int main(void) {
    FwPokemon party[6] = {{0}};
    assert(fw_select(0, 0) == -1 && fw_select(party, 0) == -1 && fw_select(party, 7) == -1);
    party[0].species=1;party[0].egg=1;party[0].hp=10; assert(fw_select(party,1)==-1);
    party[1].species=2;party[2].species=3;party[2].hp=1;
    assert(fw_select(party,3)==2);party[2].hp=0;assert(fw_select(party,3)==1);
    party[1].max_hp=100;party[1].hp=25;assert(fw_tired(&party[1]));party[1].hp=26;assert(!fw_tired(&party[1]));
    FwPokemon a=party[1],b=a;assert(fw_same_identity(&a,&b)); b.personality++;assert(!fw_same_identity(&a,&b));
    b=a;b.shiny=1;assert(!fw_same_identity(&a,&b)); b=a;b.form++;assert(!fw_same_identity(&a,&b));
    FwFollower f;fw_init(&f,1);f.state=FW_FOLLOWING;f.actor=1;assert(fw_interact(&f));assert(f.state==FW_INTERACTING);
    for(unsigned state=FW_ABSENT;state<=FW_EVENT_PAUSED;++state)
        assert(fw_idle_animation_enabled((FwState)state,1,0)==(state==FW_FOLLOWING));
    assert(!fw_idle_animation_enabled(FW_FOLLOWING,0,0));
    assert(!fw_idle_animation_enabled(FW_FOLLOWING,1,1));
    fw_enter(&f,FW_WARP);fw_end_interaction(&f);assert(f.state==FW_SUPPRESSED);
    fw_enter(&f,FW_MENU);fw_enter(&f,FW_MENU);fw_leave(&f,FW_MENU);fw_leave(&f,FW_WARP);assert(fw_suppressed(&f));
    fw_leave(&f,FW_MENU);assert(!fw_suppressed(&f)&&f.state==FW_WAITING);fw_leave(&f,FW_MENU);assert(!fw_suppressed(&f));
    for(int i=0;i<256;i++) fw_enter(&f,FW_SCRIPT);
    for(int i=0;i<300;i++) fw_leave(&f,FW_SCRIPT);
    assert(fw_suppressed(&f));
    FwTrail t;FwSample out;fw_trail_clear(&t);
    for(int i=0;i<=32;i++){FwSample s=sample(i*4096,0,0,1,FW_GRID);int r=fw_trail_push(&t,&s,&out,6);if(i>=22){assert(r==1);assert(out.x==(i-22)*4096);}else assert(r==0);}
    /* Reverse along the recorded route; no seek-to-player shortcut. */
    for(int i=31;i>=16;i--){FwSample s=sample(i*4096,0,0,1,FW_GRID);assert(fw_trail_push(&t,&s,&out,6)==1);assert(out.x==(42-i)*4096);}
    FwSample s=sample(16*4096,0,0,2,FW_GRID);assert(fw_trail_push(&t,&s,&out,6)==-1&&t.count==0);
    assert(fw_trail_push(&t,&s,&out,6)==0);s.x+=FW_TILE*2;assert(fw_trail_push(&t,&s,&out,6)==-1);
    fw_trail_clear(&t);s=sample(0,0,0,1,FW_RAIL);s.rail=1;assert(fw_trail_push(&t,&s,&out,6)==0);
    s.x=4096;s.rail=2;assert(fw_trail_push(&t,&s,&out,6)==-1);
    s.connection=5;assert(fw_trail_push(&t,&s,&out,6)==0);s.x+=4096;s.rail=3;assert(fw_trail_push(&t,&s,&out,6)==0);
    fw_trail_clear(&t);s=sample(0,0,0,1,FW_WORLD);assert(!fw_trail_push(&t,&s,&out,6));
    for(int i=0;i<1000;i++) assert(!fw_trail_push(&t,&s,&out,6));assert(t.count==1);
    for(unsigned i=1;i<FW_TRAIL_CAPACITY;i++){s.x=(int)i;assert(!fw_trail_push(&t,&s,&out,6));}
    assert(t.count==FW_TRAIL_CAPACITY);
    s.x++;assert(fw_trail_push(&t,&s,&out,6)==-1&&t.count==0);
    assert(fw_trail_push(&t,&s,&out,6)==0&&t.count==1);
    fw_trail_clear(&t);
    for(int i=0;i<=48;i++){s=sample(i*4096,i<16?0:(i<32?(i-16)*1024:0),0,1,FW_LEDGE);int r=fw_trail_push(&t,&s,&out,6);if(i>=38){assert(r==1);assert(out.kind==FW_LEDGE);assert(out.y==(i-38)*1024);}}
    /* Cardinal gaps at walking/running speeds and both coordinate signs. */
    for(unsigned gap_value=0;gap_value<=6;gap_value++) for(int axis=0;axis<2;axis++) for(int sign=-1;sign<=1;sign+=2) for(int speed=1;speed<=2;speed++) {
        fw_trail_clear(&t);int gap=axis?16:16+(int)gap_value;
        for(int i=0;i<=400;i+=speed){
            s=sample(axis?0:sign*i*4096,0,axis?sign*i*4096:0,1,FW_WORLD);
            int r=fw_trail_push(&t,&s,&out,gap_value);
            assert(r==(i>=gap));
            if(r)assert((axis?out.z:out.x)==sign*(i-gap-(i-gap)%speed)*4096);
        }
        FwSample old=out;unsigned count=t.count,head=t.head;uint32_t dist=t.distance;
        s.direction=2;for(int idle=0;idle<60;idle++)assert(!fw_trail_push(&t,&s,&out,gap_value));
        assert(t.count==count&&t.head==head&&t.distance==dist&&!memcmp(&old,&out,sizeof(out)));
    }
    /* Repeated L bends and heights: every result is an actual earlier pose,
       advances monotonically through history, and never snaps a six-unit gap. */
    FwSample route[800];fw_trail_clear(&t);int x=0,z=0,last_index=-1;
    for(int i=0;i<800;i++){
        if(i){if((i/40)%2)x+=4096;else z+=4096;}
        route[i]=sample(x,(i%13)*512,z,1,FW_WORLD);route[i].duration=(uint16_t)i;
        int r=fw_trail_push(&t,&route[i],&out,6);assert(r>=0);
        if(r){int at=out.duration;assert(at<=i&&at>=last_index);
            assert(!memcmp(&out,&route[at],sizeof(out)));
            if(last_index>=0)assert(at-last_index<=2);
            last_index=at;
        }
    }
    for(unsigned code=0;code<=65535;code++){
        unsigned expected=10;
        if(code<377)expected=code;else if(code>=4096&&code<4716)expected=code-3719;else if(code>=8192&&code<8203)expected=code-7195;
        assert(fw_stock_row(code)==expected);assert(fw_object_row(code,0)==expected);
        if(code<0x3000||code>=0x3000+4096)assert(fw_object_row(code,4096)==expected);
    }
    assert(fw_object_row(0x3000,1)==1008);assert(fw_object_row(0x3001,1)==10);assert(fw_object_row(0x3000,4097)==10);
    assert(fw_descriptor_offset(2341)==65552);assert(fw_descriptor_offset(5103)==142888);
    puts("Follower host logic: selection, identity, suppression, trail, mapping and wide offsets passed.");
}

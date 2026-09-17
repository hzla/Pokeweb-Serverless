#pragma once
#include "logic.h"
namespace learnset {
constexpr u32 MaxPersonal = 4096;
struct Evolution { u16 method, parameter, target; };
struct Evolutions { Evolution entries[8]; u8 count; bool valid; };
inline Evolutions parseEvolutions(const u8* data, u32 length, u32 count) {
    Evolutions out = {};
    if (!data || (length != 42 && length != 48)) return out;
    for (u32 i=0; i<length; i+=6) {
        Evolution e={read16(data+i),read16(data+i+2),read16(data+i+4)};
        if (!e.method) continue;
        if (!e.target || e.target>=count) return {};
        out.entries[out.count++]=e;
    }
    out.valid=true;
    return out;
}
struct InfoNode { u16 species, form, parent, next; bool valid, evolutionValid; };
struct Chain { u16 ids[3]; u8 count, selected; bool before, after; };
struct Abilities { u8 ids[3]; bool hidden[3]; u8 count; };
inline Abilities infoAbilities(const u8* slots) {
    Abilities out={};
    for(u32 slot=0;slot<3;++slot) {
        if(!slots[slot])continue;
        u32 index=0;while(index<out.count && out.ids[index]!=slots[slot])++index;
        if(index==out.count)out.ids[out.count++]=slots[slot];
        if(slot==2)out.hidden[index]=true;
    }
    return out;
}
inline bool sameNode(const InfoNode* nodes,u16 a,u16 b) {
    return nodes[a].species==nodes[b].species && nodes[a].form==nodes[b].form;
}
inline Chain infoChain(const InfoNode* nodes,u32 count,u16 selected,u16 outgoing=End) {
    Chain c={};
    if (!nodes || !selected || selected>=count || !nodes[selected].valid) return c;
    c.ids[0]=selected; c.count=1;
    auto admissible=[&](u16 id) {
        if (!id || id>=count || !nodes[id].valid) return false;
        for(u32 i=0;i<c.count;++i) if(sameNode(nodes,id,c.ids[i])) return false;
        return true;
    };
    auto prepend=[&](u16 id) {
        for(u32 i=c.count;i;--i)c.ids[i]=c.ids[i-1];
        c.ids[0]=id; ++c.count; ++c.selected;
    };
    const u16 parent=nodes[selected].parent, next=outgoing==End?nodes[selected].next:outgoing;
    if(admissible(parent)) prepend(parent);
    if(admissible(next)) c.ids[c.count++]=next;
    if(c.count<3) {
        if(c.selected+1<c.count) {
            const u16 id=nodes[c.ids[c.count-1]].next;
            if(admissible(id))c.ids[c.count++]=id;
        } else if(c.selected) {
            const u16 id=nodes[c.ids[0]].parent;
            if(admissible(id))prepend(id);
        }
    }
    c.before=admissible(nodes[c.ids[0]].parent);
    c.after=admissible(c.ids[c.count-1]==selected?next:nodes[c.ids[c.count-1]].next);
    return c;
}
struct FamilyStep { u16 target,parent; };
inline u32 familyTargets(const InfoNode* nodes,u32 count,const Evolutions& e,u16* ids) {
    if(!e.valid)return 0;
    u32 n=0;
    for(u32 i=0;i<e.count && i<8;++i) {
        const u16 id=e.entries[i].target;
        if(!id || id>=count || !nodes[id].valid)continue;
        bool duplicate=false;
        for(u32 j=0;j<n;++j)if(sameNode(nodes,id,ids[j]))duplicate=true;
        if(!duplicate)ids[n++]=id;
    }
    return n;
}
// Forward visits the selected target's descendants before moving to its next
// sibling. Backward visits previous siblings, then their source. No repeated
// identity is followed inside a traversal; deliberate presses can browse cycles.
template<class Read>
inline FamilyStep familyStep(const InfoNode* nodes,u32 count,u16 selected,bool forward,Read read) {
    if(!nodes || count>MaxPersonal || !selected || selected>=count || !nodes[selected].valid)return {};
    u16 targets[8];
    if(forward) {
        const u32 n=familyTargets(nodes,count,read(selected),targets);
        for(u32 i=0;i<n;++i)if(!sameNode(nodes,targets[i],selected))return {targets[i],selected};
    }
    u8 visited[MaxPersonal/8]={};
    u16 current=selected;
    for(u32 depth=0;depth<count;++depth) {
        if(visited[current/8]&(1u<<(current&7)))break;
        visited[current/8]|=1u<<(current&7);
        const u16 parent=nodes[current].parent;
        if(!parent || parent>=count || !nodes[parent].valid || sameNode(nodes,parent,current))break;
        const u32 n=familyTargets(nodes,count,read(parent),targets);
        u32 at=0;while(at<n && !sameNode(nodes,targets[at],current))++at;
        if(!forward) {
            if(at<n && at)return {targets[at-1],parent};
            return {parent,nodes[parent].parent};
        }
        for(u32 i=at+1;i<n;++i)if(!sameNode(nodes,targets[i],selected))return {targets[i],parent};
        current=parent;
    }
    return {};
}
inline u32 statBar(u32 value,u32 width=46) {
    u32 scaled=value*width+127,result=0;
    while(scaled>=255){scaled-=255;++result;}
    return result;
}
inline u32 copyText(u16* out,u32 capacity,const u16* in) {
    if(!capacity)return 0;
    u32 n=0; if(in)while(in[n] && in[n]!=End && n+1<capacity){out[n]=in[n];++n;}
    out[n]=End; return n;
}
inline void asciiText(u16* out,u32 capacity,const char* in) {
    u32 n=0;while(*in && n+1<capacity)out[n++]=static_cast<u8>(*in++);
    if(capacity)out[n]=End;
}
inline u16 infoUpper(u16 c) {
    // US ROM names can still contain accented Latin letters in edited ROMs.
    if ((c>='a' && c<='z') || (c>=0xe0 && c<=0xf6) || (c>=0xf8 && c<=0xfe)) return c-32;
    if (c==0xff) return 0x178;
    if (c==0x153) return 0x152;
    return c;
}
inline u16 infoLower(u16 c) {
    if ((c>='A' && c<='Z') || (c>=0xc0 && c<=0xd6) || (c>=0xd8 && c<=0xde)) return c+32;
    if (c==0x178) return 0xff;
    if (c==0x152) return 0x153;
    return c;
}
inline void infoTitleCase(u16* text) {
    bool first=true;
    for(u32 i=0;text[i] && text[i]!=End;++i) {
        const u16 c=text[i],upper=infoUpper(c),lower=infoLower(c);
        if(upper!=lower) {text[i]=first?upper:lower;first=false;}
        else if(c!='\'' && c!=0x2019 && !(c>='0' && c<='9'))first=true;
    }
}
inline void expandInfo(u16* out,u32 capacity,const u16* format,const u16* a,const u16* b=nullptr) {
    u32 n=0;
    if(!capacity)return;
    while(format && *format!=End && *format && n+1<capacity) {
        if(format[0]=='{' && (format[1]=='0' || format[1]=='1') && format[2]=='}') {
            const u16* value=format[1]=='0'?a:b;
            if(value)while(*value && *value!=End && n+1<capacity)out[n++]=*value++;
            format+=3;
        } else out[n++]=*format++;
    }
    out[n]=End;
}
// Word wrap with a guaranteed advance even for a single over-wide glyph.
// Offsets identify continuation pages without copying/losing text.
template<class Measure>
inline u32 wrapInfo(const u16* text,u32 start,u16* line,u32 capacity,u32 width,Measure measure) {
    u32 end=start,n=0,space=0;
    while(text[end]!=End && text[end] && text[end]!='\n' && n+1<capacity) {
        line[n++]=text[end++];line[n]=End;
        if(measure(line)>width) {--n;--end;break;}
        if(line[n-1]==' ')space=end;
    }
    if(end==start && text[end]!=End && text[end]) {line[0]=text[end++];n=1;}
    else if(text[end]!=End && text[end] && text[end]!='\n' && space>start) {end=space;n=end-start;}
    while(n && line[n-1]==' ')--n;
    line[n]=End;
    while(text[end]==' ' || text[end]=='\n')++end;
    return end;
}
// DS 4bpp tiles, 32 tiles per row for the full upper screen.
inline void infoPixel(u8* pixels,u32 x,u32 y,u8 color) {
    if(x>=256 || y>=192)return;
    const u32 offset=((y/8)*32+x/8)*32+(y%8)*4+(x%8)/2;
    const u32 shift=(x&1)*4;
    pixels[offset]=u8((pixels[offset]&~(15u<<shift))|((color&15u)<<shift));
}
inline void infoRect(u8* pixels,u32 x,u32 y,u32 w,u32 h,u8 color) {
    for(u32 j=y;j<y+h && j<192;++j)for(u32 i=x;i<x+w && i<256;++i)infoPixel(pixels,i,j,color);
}
}

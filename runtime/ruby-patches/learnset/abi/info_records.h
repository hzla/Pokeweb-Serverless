#pragma once
namespace {
struct Page { u16 offset; u8 option; bool incoming; };
}
namespace {
struct DisplayChain { Chain chain; InfoNode nodes[3]; };
}
namespace {
struct IconKey { u16 species,form,gender; };
}
namespace {
struct InfoView {
    void* work;
    u16 selectedName[64], title[96], partyCue[12], requirements[8][256];
    u16 targets[8][64], labels[6][16], status[64];
    u16 statsUnavailable[64];
    u16 abilityNames[3][64]; Abilities abilities;
    u8 iconFrame,iconTicks;
    u8 types[2],typeCount;
    u8 stats[6]; bool statsValid, evolutionValid;
    Chain chain; DisplayChain branches[8]; u16 gender;
    u8 iconSlots[3];
    Page pages[128]; u16 pageCount,page;
    ViewSelection navigation[2];
};
}
namespace {
struct InfoState : InfoView {
    // Read-only ROM data shared by selections within this viewer session.
    // Native windows, party data and the field request are never cached here.
    u8 icons[3][1024]; u16 palettes[3][16];
    IconKey iconKeys[3]; bool iconsValid[3];
    InfoNode* graph; u32 graphCount; bool graphReady;
};
}
namespace {
struct Archive {
    u32 file[20]={},size=0,count=0,image=0,imageSize=0; bool opened=false;
    // Fixed-size streaming windows, never an allocation proportional to a
    // hacked archive's payload size. Allocation failure uses the bounded reader.
    struct Cache { u32 fatAt,fatLength,dataAt,dataLength; u8 fat[1024],data[4096]; };
    Cache* cache=nullptr;
    bool read(u32 offset,void* out,u32 length) ;
    bool open(const char* path) ;
    void buffer() ;
    void unbuffer() ;
    bool cachedRead(u32 offset,void* out,u32 length,bool fat) ;
    u32 member(u32 id,void* out,u32 capacity,bool prefix=false) ;
    ~Archive();
};
}
namespace {
struct Messages : Archive {
    void* privateHandle=nullptr; void* nameHandle=nullptr; u32 nameBank=0;
    struct Bank {u16 id,count;bool checked,valid;}; Bank banks[6]={};
    void* handle(u32 bank,u32 id) ;
    ~Messages();
};
}

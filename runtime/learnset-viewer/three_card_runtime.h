// Included by info.cpp in BW1 and opt-in BW2 tiled builds.
constexpr u32 ScreenTiles=32, TileBytes=32;
// BG3 characters start at 0x8000 and the first screen map starts at 0xF000.
constexpr u32 BlankArtTile=(0xf000-0x8000)/TileBytes-1;

struct UpperRegion {
    u32 x,y,w,h;
    void (*draw)(const Surface&);
    constexpr u32 tiles() const { return w*h; }
};
constexpr UpperRegion UpperRegions[]={
    {0,0,32,3,drawHeader},
    {0,4,13,13,drawStats},
    {14,4,18,5,drawFamily},
    {14,11,18,6,drawAbilities},
    {0,18,32,6,drawEvolution},
};
constexpr u32 ScratchBytes=32*6*TileBytes;
constexpr u32 OverlayTileCount=1+UpperRegions[0].tiles()+UpperRegions[1].tiles()
    +UpperRegions[2].tiles()+UpperRegions[3].tiles()+UpperRegions[4].tiles();
constexpr UpperRegion FamilyRegion=UpperRegions[2];
static_assert(UpperRegions[1].tiles()*TileBytes<=ScratchBytes);
u8* upperScratch;
u32 overlayBlank;
u16 originalFamilyMap[FamilyRegion.tiles()];

u16* upperMap(u32 bg) {
    return native<u16*(*)(u32)>(0x2045841,0x2045815)(bg);
}
void uploadTiles(u32 bg,const void* data,u32 size,u32 first) {
    native<void(*)(u32,const void*,u32,u32)>(0x20450ad,0x2045081)(bg,data,size,first);
}
void queueMap(u32 bg) {
    native<void(*)(u32)>(0x2045ba9,0x2045b7d)(bg);
}
u32 regionFirstTile(u32 region) {
    u32 first=overlayBlank+1;
    for(u32 i=0;i<region;++i)first+=UpperRegions[i].tiles();
    return first;
}
// Keeping the asset uploads separate lets replacing the artwork use the real
// Nitro formats while streaming each member through the eventual draw buffer.
bool validNitro(const u8* header,u32 magic,u32 section,u32 size) {
    return read32(header)==magic && read16(header+4)==0xfffe
        && read32(header+8)==size && read16(header+12)==16
        && read16(header+14)==1 && read32(header+16)==section && read32(header+20)==size-16;
}

bool loadTiledArt(Archive& art,u8* scratch,u16* screen) {
    u8 header[48];
    const u32 tilesFile=art.memberSize(0);
    if(art.member(0,header,sizeof(header),true)!=48 ||
        !validNitro(header,0x4e434752,0x43484152,tilesFile) ||
        read32(header+28)!=3 || (read32(header+36)&0xff)!=0 ||
        read32(header+40)!=tilesFile-48 || read32(header+44)!=24)return false;
    const u32 tileCount=(tilesFile-48)/TileBytes;
    if(!tileCount || tileCount>BlankArtTile || tilesFile!=48+tileCount*TileBytes)return false;

    constexpr u32 ScreenBytes=32*32*sizeof(u16);
    constexpr u32 MapFileBytes=36+ScreenBytes;
    if(art.member(1,scratch,ScratchBytes)!=MapFileBytes ||
        !validNitro(scratch,0x4e534352,0x5343524e,MapFileBytes) ||
        read16(scratch+24)!=256 || read16(scratch+26)!=256 ||
        read32(scratch+28)!=0 || read32(scratch+32)!=ScreenBytes)return false;
    for(u32 i=0;i<32*32;++i) {
        const u16 entry=read16(scratch+36+2*i);
        const u32 bank=entry>>12;
        if(i<32*24 && ((entry&1023)>=tileCount || (bank!=8 && bank!=9 && bank!=13 && bank!=14)))
            return false;
        screen[i]=entry;
    }
    for(u32 y=0;y<FamilyRegion.h;++y)for(u32 x=0;x<FamilyRegion.w;++x)
        originalFamilyMap[y*FamilyRegion.w+x]=screen[(FamilyRegion.y+y)*32+FamilyRegion.x+x];

    for(u32 offset=48;offset<tilesFile;) {
        const u32 bytes=tilesFile-offset<ScratchBytes?tilesFile-offset:ScratchBytes;
        if(!art.memberSlice(0,offset,scratch,bytes))return false;
        uploadTiles(3,scratch,bytes,(offset-48)/TileBytes);
        offset+=bytes;
    }
    for(u32 i=0;i<TileBytes;++i)scratch[i]=0;
    uploadTiles(3,scratch,TileBytes,BlankArtTile);

    constexpr u32 PalFileBytes=40+512;
    if(art.member(2,scratch,ScratchBytes)!=PalFileBytes ||
        !validNitro(scratch,0x4e434c52,0x504c5454,PalFileBytes) ||
        read32(scratch+24)!=3 || read32(scratch+32)!=512 || read32(scratch+36)!=16)return false;
    volatile u16* palette=reinterpret_cast<volatile u16*>(0x05000000);
    constexpr u32 ArtBanks[]={8,9,13,14};
    for(u32 bank : ArtBanks)for(u32 i=0;i<16;++i)
        palette[bank*16+i]=read16(scratch+40+(bank*16+i)*2);
    palette[0]=palette[9*16+9];
    return true;
}

bool prepareTiledUpper() {
    if(!learnsetWantsTiledUpper())return false;
    Archive art;
    if(!art.open(TiledArtPath,true) || art.count!=3)return false;
    u16* fg=upperMap(2);
    u16* bg=upperMap(3);
    if(!fg || !bg)return false;
    auto* scratch=static_cast<u8*>(alloc(Heap,ScratchBytes));
    if(!scratch)return false;
    if(!loadTiledArt(art,scratch,bg)){release(scratch);return false;}
    const u32 first=native<u32(*)(u32,u32,u32)>(0x2044591,0x2044565)(2,OverlayTileCount*TileBytes,0);
    if(first==0xffffffff){release(scratch);return false;}
    overlayBlank=first;
    for(u32 i=0;i<TileBytes;++i)scratch[i]=0;
    uploadTiles(2,scratch,TileBytes,overlayBlank);
    for(u32 i=0;i<32*32;++i)fg[i]=u16(overlayBlank);
    queueMap(3);
    queueMap(2);
    upperScratch=scratch;
    return true;
}

void paintTiledRegion(u32 index,bool assignMap=true) {
    const auto& region=UpperRegions[index];
    const u32 first=regionFirstTile(index),size=region.tiles()*TileBytes;
    for(u32 i=0;i<size;++i)upperScratch[i]=0;
    BitmapView bitmap{upperScratch,u16(region.w*8),u16(region.h*8),32,1};
    const Surface surface{&bitmap,upperScratch,region.x*8,region.y*8,bitmap.width,bitmap.height};
    if(index==1 && state->statsValid) {
        for(u32 y=33;y<ThreeCardBottom-1;++y)
            surface.rect(3,y,(y<38?27+y-33:32)-3,1,13);
    }
    region.draw(surface);
    uploadTiles(2,upperScratch,size,first);
    if(!assignMap)return;
    u16* fg=upperMap(2);
    for(u32 y=0;y<region.h;++y)for(u32 x=0;x<region.w;++x) {
        const u32 bank=region.y==0?14:region.y==18?13:
            region.x==0 && x<4 && state->statsValid?8:9;
        fg[(region.y+y)*ScreenTiles+region.x+x]=u16((bank<<12)|(first+y*region.w+x));
    }
}

void animateTiledFamily() {
    // Selection and tile positions stay fixed between the two idle poses.
    paintTiledRegion(2,false);
}

void renderTiledUpper() {
    for(u32 i=0;i<sizeof(UpperRegions)/sizeof(UpperRegions[0]);++i)paintTiledRegion(i);
    u16* fg=upperMap(2);
    u16* bg=upperMap(3);
    for(u32 y=0;y<FamilyRegion.h;++y)for(u32 x=0;x<FamilyRegion.w;++x)
        bg[(FamilyRegion.y+y)*32+FamilyRegion.x+x]=originalFamilyMap[y*FamilyRegion.w+x];

    // Transparent pixels in an icon's original bitmap showed the face-colored
    // backdrop. Hide the BG3 art only under those original 4-by-4 tile cells.
    for(u32 i=0;i<state->chain.count;++i)if(state->iconsValid[state->iconSlots[i]]) {
        const u32 left=iconX(i)/8;
        for(u32 y=4;y<8;++y)for(u32 x=left;x<left+4;++x) {
            u16& cell=fg[y*32+x];
            cell=u16((cell&0xfff)|((10+i)<<12));
            bg[y*32+x]=BlankArtTile;
        }
    }
    volatile u16* palette=reinterpret_cast<volatile u16*>(0x05000000);
    if(state->statsValid)colorStatBars(fg,palette);
    queueMap(3);
    queueMap(2);
}

void tiledUnavailable(void* work) {
    const auto& region=UpperRegions[1];
    const u32 first=regionFirstTile(1),size=region.tiles()*TileBytes;
    for(u32 i=0;i<size;++i)upperScratch[i]=0;
    BitmapView bitmap{upperScratch,u16(region.w*8),u16(region.h*8),32,1};
    u16 text[32];
    asciiText(text,32,"Info unavailable.");
    void* buffer=at<void*>(work,0x4c);
    stringSet(buffer,text);
    native<void(*)(void*,int,int,void*,void*,u32)>(0x2021d55,0x2021d29)(
        &bitmap,8,StatY-region.y*8,buffer,at<void*>(work,0x60),StatInk);
    uploadTiles(2,upperScratch,size,first);
    u16* fg=upperMap(2);
    for(u32 y=0;y<region.h;++y)for(u32 x=0;x<region.w;++x)
        fg[(region.y+y)*32+x]=u16((9<<12)|(first+y*region.w+x));
    queueMap(2);
}

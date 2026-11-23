#pragma once

// Shared by the runtime painter and the native graphics archive generator.
#include "info_logic.h"
#include "three_card_grid.h"
namespace learnset {
#if defined(GAME_B) || defined(GAME_W)
#include "info_background_bw1.generated.h"
#else
#include "info_background.generated.h"
#endif

constexpr u16 rgb(u32 r,u32 g,u32 b){return (r>>3)|((g>>3)<<5)|((b>>3)<<10);}
constexpr u16 colors[16]={rgb(48,50,65),rgb(48,50,65),rgb(32,33,43),rgb(24,27,31),
    rgb(82,89,100),rgb(58,71,80),rgb(64,188,180),rgb(142,235,219),
    rgb(180,184,192),rgb(218,218,222),rgb(238,175,62),rgb(255,219,149),
    rgb(205,158,247),0,0,rgb(239,244,240)};
constexpr u16 HiddenAbilityColor=rgb(120,72,160);
constexpr u16 RecessTint=rgb(213,228,227), RecessRim=rgb(174,184,192), RecessLip=rgb(82,143,135);
constexpr u32 ThreeCardGap=8, ThreeCardTop=31, FamilyBottom=68,
    AbilitiesTop=FamilyBottom+1+ThreeCardGap, ThreeCardBottom=135,
    StatsRight=105, FamilyLeft=StatsRight+1+ThreeCardGap,
    ThreeCardEvolutionY=ThreeCardBottom+1+ThreeCardGap, ThreeCardIconY=32, ThreeCardAbilityY=88;
constexpr u32 ThreeCardFooterLeft=12;

inline void threeCardPalette(volatile u16* palette,u16 face,u16 foreground,u16 shadow,u16 white) {
    const u16 cardColors[16]={face,ThreeCardGridBase,RecessRim,ThreeCardGridMinor,
        rgb(66,75,90),ThreeCardGridMajor,foreground,RecessLip,colors[8],face,
        colors[10],colors[11],HiddenAbilityColor,RecessTint,shadow,rgb(248,250,250)};
    palette[0]=face;
    for(u32 i=0;i<16;++i) {
        palette[9*16+i]=palette[8*16+i]=palette[13*16+i]=cardColors[i];
        palette[14*16+i]=colors[i];
    }
    for(const auto& color:TutorBackgroundColors)palette[14*16+color.index]=color.value;
    palette[14*16+1]=cardColors[1];palette[14*16+3]=cardColors[3];palette[14*16+5]=cardColors[5];
    palette[8*16+6]=white;palette[8*16+14]=rgb(33,33,40);
    palette[8*16+13]=rgb(66,75,96);
    palette[13*16+2]=rgb(33,33,40);palette[13*16+4]=rgb(112,126,139);
    palette[13*16+10]=rgb(71,81,99);palette[13*16+13]=rgb(52,60,76);
}

inline void cardFace(u8* data,u32 left,u32 top,u32 right,u32 bottom,u32 entryCut,u32 exitCut) {
    for(u32 y=top;y<=bottom;++y) {
        const u32 start=left+(y<top+entryCut?top+entryCut-y:0);
        const u32 end=right-(y>bottom-exitCut?y-(bottom-exitCut):0);
        infoRect(data,start,y,end-start+1,1,y==top+1?15:y==bottom?4:y==top||y==bottom-1?2:9);
        infoPixel(data,start,y,2);
        infoPixel(data,end,y,4);
    }
}
inline void abilityTab(u8* data) {
    // Small custom lettering fits above three rows of native-size text.
    constexpr u8 rows[5][9]={
        {14,30,7,8,7,31,7,31,15},
        {17,17,2,8,2,4,2,16,16},
        {31,30,2,8,2,4,2,30,14},
        {17,17,2,8,2,4,2,16,1},
        {17,30,7,15,7,4,7,31,30},
    };
    for(u32 y=0;y<10;++y)infoRect(data,117,78+y,58-(y>3?y-3:0),1,4);
    constexpr u8 widths[9]={5,5,3,4,3,5,3,5,5};
    u32 x=121;
    for(u32 i=0;i<9;++i) {
        for(u32 y=0;y<5;++y)for(u32 bit=0;bit<widths[i];++bit)
            if(rows[y][i]&(1u<<(widths[i]-1-bit)))infoPixel(data,x+bit,80+y,15);
        x+=widths[i]+1;
    }
}

inline void paintThreeCardArt(u8* data,bool showAbilities) {
    infoRect(data,0,0,256,192,1);
    for(u32 y=24;y<192;y+=8)infoRect(data,0,y,256,1,3);
    for(u32 x=0;x<256;x+=8)infoRect(data,x,23,1,192-23,x%32?3:5);
    for(const auto& row:TutorBackgroundRuns)if(row.y<23)
        infoRect(data,0,row.y,256,row.height<23-row.y?row.height:23-row.y,row.color);
    cardFace(data,2,ThreeCardTop,StatsRight,ThreeCardBottom,0,5);
    cardFace(data,FamilyLeft,ThreeCardTop,253,FamilyBottom,4,3);
    cardFace(data,FamilyLeft,AbilitiesTop,253,ThreeCardBottom,3,9);
    if(showAbilities)abilityTab(data);
    for(u32 y=ThreeCardEvolutionY;y<192;++y) {
        const u32 left=y<ThreeCardEvolutionY+8?ThreeCardFooterLeft-(y-ThreeCardEvolutionY):4;
        infoRect(data,left,y,256-left,1,y==ThreeCardEvolutionY?4:10);
        if(y>ThreeCardEvolutionY && y<160) {
            const u32 end=155+y-ThreeCardEvolutionY;
            infoRect(data,left,y,end-left,1,13);
            infoPixel(data,end,y,4);
        }
        infoPixel(data,left,y,4);
    }
    infoRect(data,4,160,252,1,4);
}
}

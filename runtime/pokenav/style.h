#pragma once
#include "../learnset-viewer/runtime.h"
namespace pokenav::ui {
enum Color : u8 {
    Clear=0,Grid=1,Minor=2,Major=3,Band=4,Body=5,BodyMinor=6,BodyMajor=7,BodyBand=8,
    Plate=9,Header=10,Bevel=11,Light=12,Shadow=13,Edge=14,Water=15,Grass=16,
    WaterLight=17,GrassLight=18,Inactive=19,InactiveEdge=20,ActiveEdge=21,Diagonal=22,
    Dark=23,Track=24,Ability=25,Hidden=26,Selected=27,Cursor=31,
    SummaryWhite=231,SummaryShadow=225,TextShadow=226,CompactLabels=227,BodyText=228,BodyShadow=229,HiddenShadow=230,
    Labels=232,InactiveText=233,DisabledText=234,GrassText=235,HiddenText=236,
    WaterText=237,MutedText=238,White=239
};
struct Point {int x,y;};
struct Surface {u8* pixels;u8* mask;u8* scratch;void* work;void* bitmap;u8 screen;};
bool create(const u16* iconPalettes);
bool available();
void present();
void stop();
void destroy();
void tick();
void tick(bool animate);
void accent(bool land);
Surface begin(void* work,void* bitmap,u8 screen);
Surface edit(void* work,u8 screen);
void commit(Surface& s);
bool restoreBase(Surface& s,bool land);
bool needsBase(bool land);
void saveBase(Surface& s,bool land);
void restoreOutline(Surface& s,int x,int y,int w,int h);
void finish(Surface& s);
void pixel(Surface& s,int x,int y,u8 color,u8 mask=0);
void rect(Surface& s,int x,int y,int w,int h,u8 color,u8 mask=0);
void polygon(Surface& s,const Point* points,u32 count,u8 color,u8 mask=0);
void outline(Surface& s,int x,int y,int w,int h,u8 color);
void plate(Surface& s,int x,int y,int w,int h,u8 color=Plate);
void flap(Surface& s,int x,int y,int w,const char* title,u8 color);
u32 measure(Surface& s,const u16* value);
u32 measureFont(void* work,void* bitmap,const u16* value);
void fit(Surface& s,u16* value,u32 width);
void text(Surface& s,const u16* value,int x,int y,u8 color=White);
void label(Surface& s,const char* value,int x,int y,u8 color=White);
void smallText(Surface& s,const u16* value,int x,int y,u8 color=CompactLabels);
void smallLabel(Surface& s,const char* value,int x,int y,u8 color=CompactLabels);
void icon(Surface& s,const u8* tiles,u8 palette,int x,int y,bool muted=false);
void footer(Surface& s);
}

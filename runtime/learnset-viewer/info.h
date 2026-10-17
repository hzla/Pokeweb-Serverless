#pragma once
#include "runtime.h"
extern "C" bool LearnsetIsActive();
struct InfoContext { learnset::ViewIdentity identity; unsigned char chance,land; };
void infoInit(void* work,Request* request);
void infoInit(void* work,Request* request,const InfoContext* context);
void infoReload(void* work,Request* request);
void infoReload(void* work,Request* request,const InfoContext* context);
void infoEmpty(void* work);
bool infoIcon(unsigned short species,unsigned short form,unsigned char* pixels,unsigned char* palette);
void infoIcons(const learnset::ViewIdentity* identities,learnset::u32 count,unsigned char* pixels,unsigned char* palettes,bool* valid);
bool infoIconPalettes(learnset::u16* colors);
void infoName(learnset::u32 bank,learnset::u32 id,learnset::u16* text,learnset::u32 capacity);
void infoInput(void* work);
bool infoNavigate(void* work,Request* request,bool forward);
void infoEnd();

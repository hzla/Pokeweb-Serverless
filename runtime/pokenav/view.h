#pragma once
#include "../learnset-viewer/runtime.h"
#include "logic.h"
bool pokenavActive();
bool pokenavBegin(void* data,Request** request);
void pokenavInit(void* work);
bool pokenavInput(void* work);
void pokenavFrame(void* work);
void pokenavEnd();
void pokenavStop();
void* pokenavWindow(u32 frame,u32 x,u32 y,u32 width,u32 height,u32 palette,u32 direction);

#pragma once
#include "runtime.h"
extern "C" bool LearnsetIsActive();
void infoInit(void* work,Request* request);
void infoReload(void* work,Request* request);
void infoInput(void* work);
bool infoNavigate(void* work,Request* request,bool forward);
void infoEnd();

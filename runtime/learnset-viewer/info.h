#pragma once
#include "runtime.h"
extern "C" bool LearnsetIsActive();
void infoInit(void* work,Request* request);
void infoInput(void* work);
void infoEnd();

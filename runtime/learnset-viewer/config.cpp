#include "runtime.h"
extern "C" {
__attribute__((used,section(".learnset_config"))) volatile Config learnsetConfig = {
    {'L','S','V','M','S','G','1',0}, 1, End, 0, End, 0, End, 0, 0
};
}

extern "C" { __attribute__((used,section(".custom_ui_config"))) volatile CustomConfig customUiConfig = {
    {'P','W','U','I','C','F','G','1'},1,0,End,0,1,0
}; }

#ifndef POKEBW2_FIELD_SCRCMD_SHOP_H
#define POKEBW2_FIELD_SCRCMD_SHOP_H

// Overlay 36's scrcmd_shop.c: the shop command and the shop's menu. Names from swan
// (https://github.com/ds-pokemon-hacking/swan, GPL-3.0)

#include "types.h"
#include "struct_decls.h"
#include "system/vm.h"

BOOL s0149_CallFriendlyShopBuy(VM *vm, FieldScriptEnv *env);

#endif // POKEBW2_FIELD_SCRCMD_SHOP_H

#pragma once
namespace {
struct MenuItem { void* text; u16 color; u16 pad; u32 cancel; };
}
namespace {
struct MenuWork { u8 count; u8 pad; u16 ids[8]; u16 padding; MenuItem items[8]; };
}

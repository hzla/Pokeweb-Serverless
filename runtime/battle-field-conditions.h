/* Read battle state without dispatching events. Side predicates are relative
 * to the move user or item holder, regardless of the selected target. */
static u32 battleSideCondition(const volatile u32 *readers, void *flow, u8 owner, u32 condition) {
 u32 side=((u32(*)(u8))(uintptr_t)readers[1])(owner)^((condition>>8)&1);
 return ((u32(*)(void*,u8,u32))(uintptr_t)readers[2])(flow,(u8)side,condition&255)>=(condition>>9);
}

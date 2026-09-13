#ifndef __W2U_MENU_EVOLUTION_SCRIPT_API_H
#define __W2U_MENU_EVOLUTION_SCRIPT_API_H

// The Menu Evolution companion extends the retail Gen 5
// GetPartyPokeParameter field-script command instead of allocating a new
// opcode. Its encoded operands remain:
//
//   0x010C, destination work, party slot, parameter ID
//
// Party slots are zero based (0..5). Invalid slots, invalid PK5 checksums,
// and unsupported parameter IDs return zero.
#define W2U_SCRCMD_GET_PARTY_POKE_PARAMETER 0x010C

// These IDs are deliberately outside the retail PK5 parameter range. They
// are read-only and return the individual Pokemon's persistent u16 counters.
#define W2U_SCR_POKEPARA_KOS 0x0400
#define W2U_SCR_POKEPARA_BATTLES_BROUGHT 0x0401
#define W2U_SCR_POKEPARA_BATTLES_USED 0x0402

#endif // __W2U_MENU_EVOLUTION_SCRIPT_API_H

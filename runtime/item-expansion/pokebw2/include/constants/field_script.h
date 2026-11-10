#ifndef POKEBW2_CONSTANTS_FIELD_SCRIPT_H
#define POKEBW2_CONSTANTS_FIELD_SCRIPT_H

// Comparisons. VMStackCmp pops two values and pushes whether the one pushed first compares so with the other.
// VMJumpIf and VMCallIf test the comparison register, which WorkCmpConst and the other Cmp commands set
#define CMP_LT 0
#define CMP_EQ 1
#define CMP_GT 2
#define CMP_LE 3
#define CMP_GE 4
#define CMP_NE 5
// VMStackCmp only: whether either value or both are TRUE
#define CMP_OR 6
#define CMP_AND 7
// VMJumpIf and VMCallIf: jump if the value popped from the stack is TRUE, instead of testing the comparison register
#define CMP_STACK 0xFF

// Script variables. Arguments that take a value can take a variable instead
#define VARS_START 0x4000       // saved event work
#define LOCAL_VARS_START 0x8000 // work of the script
#define VARS_END 0xC000

// The text file of the script, instead of a file of the script message archive
#define MSGFILE_SCRIPT 0x400

#endif // POKEBW2_CONSTANTS_FIELD_SCRIPT_H

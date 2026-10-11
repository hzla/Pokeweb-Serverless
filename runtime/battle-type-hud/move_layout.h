#pragma once
// BW1 values come from its generated native profile. BW2 retains its ABI.
#if !defined(BW1_MOVE_PROFILE)
constexpr unsigned MoveRule=0x50, MoveScreen=0x58, MoveState=0x68, MovePfd=0x64;
constexpr unsigned MoveWindow=0x2ac, MoveBitmap=0x2b0;
constexpr unsigned MoveSelectedActive=0x300, MoveSelectedSlots=0x2c8;
constexpr unsigned MoveMoveArray=0x2f0, MoveRotationMons=0x330;
#endif

.thumb

@ Deliberately contains no hook-named symbols.  Serverless uses this tiny valid
@ DLXF image to retire an already-exported legacy monolithic PWAN runtime in
@ place, avoiding ROM filesystem ID shifts during migration to the split DLLs.
.global PokewebPwanLegacyRetired
.type PokewebPwanLegacyRetired, %function
PokewebPwanLegacyRetired:
    bx lr
    .size PokewebPwanLegacyRetired, . - PokewebPwanLegacyRetired

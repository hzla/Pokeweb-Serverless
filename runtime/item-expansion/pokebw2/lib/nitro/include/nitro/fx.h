#ifndef POKEBW2_NITRO_FX_H
#define POKEBW2_NITRO_FX_H

#include "types.h"

// Fixed point numbers with 12 fractional bits. The types, constants and conversions are NitroSDK's (its fx.h, and the
// fx_const.h it generates, as ntrtwl's NitroSDK and pret's pokediamond have them): fx32 is a long, and its constants
// carry an L.
typedef s16 fx16;
typedef s32 fx32;
typedef s64 fx64;
// A 64-bit fixed point number with 32 fractional bits, as the divider gives its quotients
typedef s64 fx64c;

#define FX16_SHIFT 12
#define FX16_ONE ((fx16)0x1000)
#define FX32_SHIFT 12
#define FX32_DEC_MASK 0x00000fff
#define FX32_MAX ((fx32)0x7fffffff)
#define FX32_MIN ((fx32)0x80000000)
#define FX32_ONE ((fx32)0x00001000L)
#define FX32_HALF ((fx32)0x00000800L)
// Conversions between fixed point numbers and floats, rounded to the nearest
#define FX_FX16_TO_F32(x) ((f32)((x) / (f32)(1 << FX16_SHIFT)))
#define FX_F32_TO_FX16(x)                                                                                              \
    ((fx16)(((x) > 0) ? (fx16)((x) * (1 << FX16_SHIFT) + 0.5f) : (fx16)((x) * (1 << FX16_SHIFT) - 0.5f)))
#define FX16_CONST(x) FX_F32_TO_FX16(x)
#define FX_FX32_TO_F32(x) ((f32)((x) / (f32)(1 << FX32_SHIFT)))
#define FX_F32_TO_FX32(x) ((fx32)(((x) > 0) ? ((x) * (1 << FX32_SHIFT) + 0.5f) : ((x) * (1 << FX32_SHIFT) - 0.5f)))
#define FX32_CONST(x) FX_F32_TO_FX32(x)
#define FX_Whole(a) ((s32)((a) >> FX32_SHIFT))

typedef struct {
    fx32 x;
    fx32 y;
    fx32 z;
} VecFx32;

typedef struct {
    fx16 x;
    fx16 y;
    fx16 z;
} VecFx16;

typedef union {
    struct {
        fx32 _00, _01, _10, _11;
    };
    fx32 m[2][2];
} MtxFx22;

// A 2D affine matrix, its last row the translation
typedef struct {
    fx32 _00;
    fx32 _01;
    fx32 _10;
    fx32 _11;
    fx32 _20;
    fx32 _21;
} MtxFx32;

typedef struct {
    fx32 m[3][3];
} MtxFx33;

typedef union {
    fx32 m[4][3];
    // The rotation and scale, then the translation
    struct {
        MtxFx33 rot;
        VecFx32 trans;
    } rt;
} MtxFx43;

typedef struct {
    fx32 m[4][4];
} MtxFx44;

// The sine and cosine of 4096 angles around the circle, as pairs
extern const fx16 FX_SinCosTable_[4096 * 2];

// An angle in whole degrees as the 16-bit angle that FX_SinIdx and FX_CosIdx take, 0x10000 for a full turn
#define DEG_TO_IDX(deg) ((u16)((deg) * 0x10000 / 360))

static inline fx16 FX_SinIdx(int idx) {
    return FX_SinCosTable_[(idx >> 4) << 1];
}

static inline fx16 FX_CosIdx(int idx) {
    return FX_SinCosTable_[((idx >> 4) << 1) + 1];
}

static inline fx32 FX_Mul(fx32 v1, fx32 v2) {
    return (fx32)(((fx64)v1 * v2 + 0x800LL) >> FX32_SHIFT);
}

// The SDK's macro form, whose operands keep their types: an fx16 one makes a full 64-bit multiply
#define FX_MUL(v1, v2) ((fx32)(((fx64)(v1) * (v2) + 0x800LL) >> FX32_SHIFT))

static inline void VEC_Set(VecFx32 *v, fx32 x, fx32 y, fx32 z) {
    v->x = x;
    v->y = y;
    v->z = z;
}

static inline void VEC_Fx16Set(VecFx16 *v, fx16 x, fx16 y, fx16 z) {
    v->x = x;
    v->y = y;
    v->z = z;
}

// An angle in fixed point degrees as a 16-bit angle
#define FX64C_65536_360 ((fx64c)0x000000b60b60b60bLL)
#define FX_DEG_TO_IDX(deg) ((u16)((FX64C_65536_360 * (deg) + 0x80000000000LL) >> 44))

// libfx, in link order. The names are NitroSDK's, as ntrtwl's reconstruction of NitroSDK and pret's pokediamond and
// pmd-sky have them; swan's names are noted where they differ.

// fx_mtx22.c. Swan: MAT2_Identity, MAT2_Scaling, MAT2_Rotation, MAT2_Scale
void MTX_Identity22_(MtxFx22 *mtx);
void MTX_Scale22_(MtxFx22 *mtx, fx32 x, fx32 y);
// A rotation from its sine and cosine
void MTX_Rot22_(MtxFx22 *mtx, fx32 sin, fx32 cos);
void MTX_ScaleApply22(const MtxFx22 *src, MtxFx22 *dest, fx32 x, fx32 y);

// fx_mtx33.c. Swan: MAT3_Identity, MAT3_To4x4, MAT3_Scaling, MAT3_Scale, MAT3_RotationX/Y/Z, MAT3_RotationAxisAngle,
// MAT3_Invert, MAT3_Mul, MAT3_MulVec
void MTX_Identity33_(MtxFx33 *mtx);
void MTX_Copy33To44_(const MtxFx33 *src, MtxFx44 *dst);
void MTX_Scale33_(MtxFx33 *mtx, fx32 x, fx32 y, fx32 z);
void MTX_ScaleApply33(const MtxFx33 *src, MtxFx33 *dest, fx32 x, fx32 y, fx32 z);
// Rotations about an axis from its sine and cosine
void MTX_RotX33_(MtxFx33 *mtx, fx32 sin, fx32 cos);
void MTX_RotY33_(MtxFx33 *mtx, fx32 sin, fx32 cos);
void MTX_RotZ33_(MtxFx33 *mtx, fx32 sin, fx32 cos);
void MTX_RotAxis33(MtxFx33 *mtx, const VecFx32 *axis, fx32 sin, fx32 cos);
// Returns -1 when the matrix has no inverse
int MTX_Inverse33(const MtxFx33 *mtx, MtxFx33 *inv);
void MTX_Concat33(const MtxFx33 *a, const MtxFx33 *b, MtxFx33 *ab);
void MTX_MultVec33(const VecFx32 *vec, const MtxFx33 *mtx, VecFx32 *dest);

// fx_mtx43.c. Swan: MAT43_Identity, MAT43_To4x4, MAT43_Scaling, MAT43_Scale, MAT43_RotationY, MAT43_RotationAxisAngle,
// MAT43_Invert, MAT43_Mul, MAT43_MulVec, MAT43_LookAt
void MTX_Identity43_(MtxFx43 *mtx);
void MTX_Copy43To44_(const MtxFx43 *src, MtxFx44 *dst);
void MTX_Scale43_(MtxFx43 *mtx, fx32 x, fx32 y, fx32 z);
void MTX_ScaleApply43(const MtxFx43 *src, MtxFx43 *dest, fx32 x, fx32 y, fx32 z);
void MTX_RotY43_(MtxFx43 *mtx, fx32 sin, fx32 cos);
void MTX_RotAxis43(MtxFx43 *mtx, const VecFx32 *axis, fx32 sin, fx32 cos);
// Returns -1 when the matrix has no inverse
int MTX_Inverse43(const MtxFx43 *mtx, MtxFx43 *inv);
void MTX_Concat43(const MtxFx43 *a, const MtxFx43 *b, MtxFx43 *ab);
void MTX_MultVec43(const VecFx32 *vec, const MtxFx43 *mtx, VecFx32 *dest);
void MTX_LookAt(const VecFx32 *camPos, const VecFx32 *camUp, const VecFx32 *target, MtxFx43 *mtx);

// fx_mtx44.c. Swan: MAT4_Identity, MAT4_To4x3, MAT4_Mul, MAT4_SetFrustum, MAT4_SetPerspective, MAT4_SetOrtho
void MTX_Identity44_(MtxFx44 *mtx);
void MTX_Copy44To43_(const MtxFx44 *src, MtxFx43 *dst);
void MTX_Concat44(const MtxFx44 *a, const MtxFx44 *b, MtxFx44 *ab);
void MTX_FrustumW(fx32 t, fx32 b, fx32 l, fx32 r, fx32 n, fx32 f, fx32 scaleW, MtxFx44 *mtx);
void MTX_PerspectiveW(fx32 fovySin, fx32 fovyCos, fx32 aspect, fx32 n, fx32 f, fx32 scaleW, MtxFx44 *mtx);
void MTX_OrthoW(fx32 t, fx32 b, fx32 l, fx32 r, fx32 n, fx32 f, fx32 scaleW, MtxFx44 *mtx);

// fx_cp.c, on the hardware divider and square root unit. Swan: fx_recip_raw (FX_InvFx64c)
fx32 FX_Div(fx32 numer, fx32 denom);
fx32 FX_Inv(fx32 denom);
fx64c FX_InvFx64c(fx32 denom);
fx32 FX_Sqrt(fx32 x);
fx32 FX_InvSqrt(fx32 x);
fx64c FX_GetDivResultFx64c(void);
fx32 FX_GetDivResult(void);
void FX_InvAsync(fx32 denom);
void FX_DivAsync(fx32 numer, fx32 denom);
s32 FX_DivS32(s32 numer, s32 denom);
s32 FX_ModS32(s32 numer, s32 denom);

// fx_vec.c. Swan: vecfx_add16, vecfx_dot, vecfx_dot16, vecfx_cross, vecfx_cross16, vecfx_length16, vecfx_normalize,
// vecfx_normalize16, vecfx_muladd, vecfx_dist
void VEC_Add(const VecFx32 *a, const VecFx32 *b, VecFx32 *ab);
void VEC_Subtract(const VecFx32 *a, const VecFx32 *b, VecFx32 *ab);
void VEC_Fx16Add(const VecFx16 *a, const VecFx16 *b, VecFx16 *ab);
fx32 VEC_DotProduct(const VecFx32 *a, const VecFx32 *b);
fx32 VEC_Fx16DotProduct(const VecFx16 *a, const VecFx16 *b);
void VEC_CrossProduct(const VecFx32 *a, const VecFx32 *b, VecFx32 *axb);
void VEC_Fx16CrossProduct(const VecFx16 *a, const VecFx16 *b, VecFx16 *axb);
fx32 VEC_Mag(const VecFx32 *v);
fx32 VEC_Fx16Mag(const VecFx16 *v);
void VEC_Normalize(const VecFx32 *src, VecFx32 *dest);
void VEC_Fx16Normalize(const VecFx16 *src, VecFx16 *dest);
void VEC_MultAdd(fx32 scale, const VecFx32 *a, const VecFx32 *b, VecFx32 *dest);
fx32 VEC_Distance(const VecFx32 *a, const VecFx32 *b);

// fx_atanidx.c. Swan: fx_atan2
u16 FX_Atan2Idx(fx32 y, fx32 x);

// fx.c. Swan: fx_mul_round (FX_MulFunc, FX_Mul as a function, rounding), fx_fract (FX_Modf)
void FX_Init(void);
fx32 FX_MulFunc(fx32 v1, fx32 v2);
// The 32-bit fixed point number times a 64-bit fraction with 32 fractional bits, rounded
fx32 FX_Mul32x64cFunc(fx32 v32, fx64c v64c);
// Returns the fraction of x and writes its whole part, both with the sign of x
fx32 FX_Modf(fx32 x, fx32 *whole);

// fx_trig.c, which is fx_asinacosidx.c in the SDK. Swan: fx_acos
u16 FX_AcosIdx(fx32 x);

// GFL's calctool.c, also declared in gfl/calctool.h
void vecfx_mul(const VecFx32 *src, fx32 scale, VecFx32 *dest);
void MAT2_SetScaleRot(MtxFx22 *mtx, u16 rot, fx32 scaleX, fx32 scaleY, u8 mode);

#endif // POKEBW2_NITRO_FX_H

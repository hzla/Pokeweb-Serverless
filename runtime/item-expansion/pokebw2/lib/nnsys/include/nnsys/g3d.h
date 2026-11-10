#ifndef POKEBW2_NNSYS_G3D_H
#define POKEBW2_NNSYS_G3D_H

#include "types.h"
#include "nitro/fx.h"
#include "nitro/gx.h"
#include "nitro/mi.h"
#include "nnsys/fnd.h"
#include "nnsys/gfd.h"

// NitroSystem's 3D graphics (NNS_G3d): its resource files, the render objects that draw a model, the animation objects
// bound to them, and the global state of the geometry engine. The names are NitroSystem's, as ntrtwl's reconstruction
// of NitroSystem has them, where the code shows them, and ours elsewhere; swan's names are noted where they differ

// A resource file and its blocks. The signatures are the files' first four characters
#define NNS_G3D_SIGNATURE_BMD0 0x30444d42
#define NNS_G3D_SIGNATURE_BTX0 0x30585442
#define NNS_G3D_SIGNATURE_BCA0 0x30414342
#define NNS_G3D_SIGNATURE_BVA0 0x30415642
#define NNS_G3D_SIGNATURE_BMA0 0x30414d42
#define NNS_G3D_SIGNATURE_BTA0 0x30415442
#define NNS_G3D_SIGNATURE_BTP0 0x30505442

typedef struct {
    u32 signature;
    u16 byteOrder;
    u16 version;
    u32 fileSize;
    u16 headerSize;
    u16 dataBlocks;
} NNSG3dResFileHeader;

typedef struct {
    u32 kind;
    u32 size;
} NNSG3dResDataBlockHeader;

// A node of a dictionary's Patricia tree, which follows the dictionary's header (below): the bit of a name that the
// node tests, the nodes that a 0 and a 1 at that bit lead to, and the entry that the node stands for. The first node is
// the root, whose first child is the top of the tree, or 0 for an empty dictionary. A search follows the children for
// as long as each node tests a lower bit than the one before it, and the node it stops at has the one entry that the
// name can be
typedef struct {
    u8 refBit;
    u8 idxChild[2];
    u8 idxEntry;
} NNSG3dResDictTreeNode;

// A dictionary: a Patricia tree of names, then each entry's data of sizeUnit bytes. The tree's nodes follow the header,
// as many as there are entries and the root, so every block that holds a dictionary ends with it
typedef struct {
    u8 revision;
    u8 numEntry;
    u16 sizeDictBlk;
    u16 dummy_;
    u16 ofsEntry;
    NNSG3dResDictTreeNode node[1];
} NNSG3dResDict;

typedef struct {
    u16 sizeUnit;
    u16 ofsName;
    u8 data[4];
} NNSG3dResDictEntryHeader;

static inline void *NNS_G3dGetResDataByIdx(const NNSG3dResDict *dict, u32 idx) {
    if (dict != NULL && idx < dict->numEntry) {
        const NNSG3dResDictEntryHeader *hdr = (const NNSG3dResDictEntryHeader *)((u8 *)dict + dict->ofsEntry);

        return (void *)((u8 *)&hdr->data[0] + hdr->sizeUnit * idx);
    }
    return NULL;
}

// The texture block, with where its textures and palettes are and their VRAM keys once loaded
#define NNS_G3D_RESTEX_LOADED 0x0001
#define NNS_G3D_RESPLTT_LOADED 0x0001
#define NNS_G3D_RESPLTT_USEPLTT4 0x8000

typedef struct {
    NNSGfdTexKey vramKey;
    u16 sizeTex;
    u16 ofsDict;
    u16 flag;
    u16 dummy_;
    u32 ofsTex;
} NNSG3dResTexInfo;

typedef struct {
    NNSGfdTexKey vramKey;
    u16 sizeTex;
    u16 ofsDict;
    u16 flag;
    u16 dummy_;
    u32 ofsTex;
    u32 ofsTexPlttIdx;
} NNSG3dResTex4x4Info;

typedef struct {
    NNSGfdPlttKey vramKey;
    u16 sizePltt;
    u16 flag;
    u16 ofsDict;
    u16 dummy_;
    u32 ofsPlttData;
} NNSG3dResPlttInfo;

typedef struct {
    NNSG3dResDataBlockHeader header;
    NNSG3dResTexInfo texInfo;
    NNSG3dResTex4x4Info tex4x4Info;
    NNSG3dResPlttInfo plttInfo;
    NNSG3dResDict dict;
} NNSG3dResTex;

// A model, and the block of a file's models
typedef struct {
    u8 sbcType;
    u8 scalingRule;
    u8 texMtxMode;
    u8 numNode;
    u8 numMat;
    u8 numShp;
    u8 firstUnusedMtxStackID;
    u8 dummy_;
    fx32 posScale;
    fx32 invPosScale;
    u16 numVertex;
    u16 numPolygon;
    u16 numTriangle;
    u16 numQuad;
    // The box that holds the model, at boxPosScale
    fx16 boxX;
    fx16 boxY;
    fx16 boxZ;
    fx16 boxW;
    fx16 boxH;
    fx16 boxD;
    fx32 boxPosScale;
    fx32 boxInvPosScale;
} NNSG3dResMdlInfo;

// The nodes of a model: a dictionary of them, then each one's data. A node's data starts with its flag, followed by the
// parts of its transformation that the flag doesn't say are the identity
typedef struct {
    NNSG3dResDict dict;
} NNSG3dResNodeInfo;

typedef struct NNSG3dResMdl {
    u32 size;
    u32 ofsSbc;
    u32 ofsMat;
    u32 ofsShp;
    u32 ofsEvpMtx;
    NNSG3dResMdlInfo info;
    NNSG3dResNodeInfo nodeInfo;
} NNSG3dResMdl;

typedef struct {
    NNSG3dResDataBlockHeader header;
    NNSG3dResDict dict;
} NNSG3dResMdlSet;

static inline NNSG3dResMdl *NNS_G3dGetMdlByIdx(const NNSG3dResMdlSet *mdlSet, u32 idx) {
    const u32 *ofs = NNS_G3dGetResDataByIdx(&mdlSet->dict, idx);

    if (ofs != NULL) {
        return (NNSG3dResMdl *)((u8 *)mdlSet + *ofs);
    }
    return NULL;
}

static inline NNSG3dResMdlInfo *NNS_G3dGetMdlInfo(const NNSG3dResMdl *mdl) {
    return (NNSG3dResMdlInfo *)&mdl->info;
}

static inline NNSG3dResNodeInfo *NNS_G3dGetNodeInfo(const NNSG3dResMdl *mdl) {
    if (mdl != NULL) {
        return (NNSG3dResNodeInfo *)&mdl->nodeInfo;
    }
    return NULL;
}

// A node's data: its flag, then the first element of its rotation. The translation follows, unless the flag has
// TRANS_ZERO, then the rest of the rotation unless it has ROT_ZERO: eight more elements, or with PIVOT_EXIST two, the
// pivot's index being in the flag, and last the data of the scale (NNSG3dGetJointScale). The rotation elements are
// fx16 and the translation fx32
#define NNS_G3D_SRTFLAG_TRANS_ZERO 0x0001
#define NNS_G3D_SRTFLAG_ROT_ZERO 0x0002
#define NNS_G3D_SRTFLAG_SCALE_ONE 0x0004
#define NNS_G3D_SRTFLAG_PIVOT_EXIST 0x0008
#define NNS_G3D_SRTFLAG_IDXPIVOT_MASK 0x00f0
#define NNS_G3D_SRTFLAG_IDXPIVOT_SHIFT 4
#define NNS_G3D_SRTFLAG_PIVOT_MINUS 0x0100
#define NNS_G3D_SRTFLAG_SIGN_REVC 0x0200
#define NNS_G3D_SRTFLAG_SIGN_REVD 0x0400

typedef struct {
    u16 flag;
    fx16 _00;
} NNSG3dResNodeData;

static inline NNSG3dResNodeData *NNS_G3dGetNodeDataByIdx(const NNSG3dResNodeInfo *nodeInfo, u32 idx) {
    if (nodeInfo != NULL) {
        const u32 *ofs = NNS_G3dGetResDataByIdx(&nodeInfo->dict, idx);

        if (ofs != NULL) {
            return (NNSG3dResNodeData *)((u8 *)nodeInfo + *ofs);
        }
    }
    return NULL;
}

// What a model's envelope holds for a joint: the matrix that undoes the joint's bind pose, and for the normals
typedef struct {
    MtxFx43 invM;
    MtxFx33 invN;
} NNSG3dResEvpMtx;

// A model's material block: which materials each texture and each palette is for, then the materials by name
typedef struct {
    u16 ofsDictTexToMatList;
    u16 ofsDictPlttToMatList;
    NNSG3dResDict dict;
} NNSG3dResMat;

// The start of a material. Binding a texture adds its place in VRAM to texImageParam, and sets magW and magH to scale
// the texture coordinates by how much the stored texture differs from the size the material was made for, from
// origWidth and origHeight. Binding a palette sets texPlttBase
typedef struct {
    u16 itemTag;
    u16 size;
    u32 diffAmb;
    u32 specEmi;
    u32 polyAttr;
    u32 polyAttrMask;
    u32 texImageParam;
    u32 texImageParamMask;
    u16 texPlttBase;
    u16 flag;
    u16 origWidth;
    u16 origHeight;
    fx32 magW;
    fx32 magH;
} NNSG3dResMatData;

// The flag of a material. After the structure come the parts of its texture matrix that TEXMTX_USE says it has, leaving
// out the scale if SCALEONE is set, the rotation if ROTZERO is and the translation if TRANSZERO is; an effect matrix
// follows them. DIFFUSE, AMBIENT and VTXCOLOR say which parts of diffAmb the material sets, and SPECULAR, EMISSION and
// SHININESS those of specEmi, each as a group of three bits that index the color masks
#define NNS_G3D_MATFLAG_TEXMTX_USE 0x0001
#define NNS_G3D_MATFLAG_TEXMTX_SCALEONE 0x0002
#define NNS_G3D_MATFLAG_TEXMTX_ROTZERO 0x0004
#define NNS_G3D_MATFLAG_TEXMTX_TRANSZERO 0x0008
#define NNS_G3D_MATFLAG_WIREFRAME 0x0020
#define NNS_G3D_MATFLAG_DIFFUSE 0x0040
#define NNS_G3D_MATFLAG_AMBIENT 0x0080
#define NNS_G3D_MATFLAG_VTXCOLOR 0x0100
#define NNS_G3D_MATFLAG_SPECULAR 0x0200
#define NNS_G3D_MATFLAG_EMISSION 0x0400
#define NNS_G3D_MATFLAG_SHININESS 0x0800
#define NNS_G3D_MATFLAG_EFFECTMTX 0x2000
#define NNS_G3D_MATFLAG_DIFFAMB_SHIFT 6
#define NNS_G3D_MATFLAG_SPECEMI_SHIFT 9
#define NNS_G3D_MATFLAG_COLOR_INDEX_MASK 7

// An entry of a texture-to-material or palette-to-material dictionary: numIdx material numbers, one byte each, at
// offset from the material block. flag has NNS_G3D_MATLIST_BOUND once the texture or palette is bound to them
typedef struct {
    u16 offset;
    u8 numIdx;
    u8 flag;
} NNSG3dResDictTexToMatIdxData;

typedef NNSG3dResDictTexToMatIdxData NNSG3dResDictPlttToMatIdxData;

#define NNS_G3D_MATLIST_BOUND 0x01

static inline NNSG3dResMat *NNS_G3dGetMat(const NNSG3dResMdl *mdl) {
    if (mdl != NULL && mdl->ofsMat != 0) {
        return (NNSG3dResMat *)((u8 *)mdl + mdl->ofsMat);
    }
    return NULL;
}

static inline NNSG3dResMatData *NNS_G3dGetMatDataByIdx(const NNSG3dResMat *mat, u32 idx) {
    if (mat != NULL) {
        const u32 *ofs = NNS_G3dGetResDataByIdx(&mat->dict, idx);

        if (ofs != NULL) {
            return (NNSG3dResMatData *)((u8 *)mat + *ofs);
        }
    }
    return NULL;
}

// A model's shape block: a dictionary of the shapes by name, each one's data a tag for how it is drawn, then the
// display list that draws it and its size
typedef struct {
    NNSG3dResDict dict;
} NNSG3dResShp;

typedef struct {
    u16 itemTag;
    u16 size;
    u32 flag;
    u32 ofsDL;
    u32 sizeDL;
} NNSG3dResShpData;

static inline NNSG3dResShp *NNS_G3dGetShp(const NNSG3dResMdl *mdl) {
    if (mdl != NULL && mdl->ofsShp != 0) {
        return (NNSG3dResShp *)((u8 *)mdl + mdl->ofsShp);
    }
    return NULL;
}

static inline NNSG3dResShpData *NNS_G3dGetShpDataByIdx(const NNSG3dResShp *shp, u32 idx) {
    if (shp != NULL) {
        const u32 *ofs = NNS_G3dGetResDataByIdx(&shp->dict, idx);

        if (ofs != NULL) {
            return (NNSG3dResShpData *)((u8 *)shp + *ofs);
        }
    }
    return NULL;
}

// The animations block of a file: its animations by name, each at an offset from the block
typedef struct {
    NNSG3dResDataBlockHeader header;
    NNSG3dResDict dict;
} NNSG3dResAnmSet;

// The category of an animation resource's header: which part of a model it animates
#define NNS_G3D_DATABLK_MAT_ANM 'M'
#define NNS_G3D_DATABLK_JNT_ANM 'J'
#define NNS_G3D_DATABLK_VIS_ANM 'V'

// mapData of an animation object has this for each material or node that the animation holds data for, with the index
// of the data in the animation in the low byte. The blends skip a target that has DISABLED set as well
#define NNS_G3D_ANMOBJ_MAPDATA_EXIST 0x0100
#define NNS_G3D_ANMOBJ_MAPDATA_DISABLED 0x0200
#define NNS_G3D_ANMOBJ_MAPDATA_DATAFIELD 0x00ff

// An animation applied to a model, at a frame. Animations bound to a render object are linked by priority through
// next. mapData maps each material or node of the model to the animation's data for it
typedef struct NNSG3dAnmObj {
    fx32 frame;
    fx32 ratio;
    void *resAnm;
    void *funcAnm;
    struct NNSG3dAnmObj *next;
    const NNSG3dResTex *resTex;
    u8 priority;
    u8 numMapData;
    u16 mapData[1];
} NNSG3dAnmObj;

// The bytes an animation object takes for a model with numMapData materials or nodes, to a multiple of four
#define NNS_G3D_ANMOBJ_SIZE(numMapData) ((sizeof(NNSG3dAnmObj) + (numMapData) * sizeof(u16)) & ~3)

// The header of every animation resource
typedef struct {
    u8 category0;
    u8 revision;
    u16 category1;
} NNSG3dResAnmHeader;

// The start of every animation
typedef struct {
    NNSG3dResAnmHeader anmHeader;
    u16 numFrame;
    u16 dummy_;
} NNSG3dResAnmCommon;

static inline fx32 NNS_G3dAnmObjGetNumFrame(const NNSG3dAnmObj *anmObj) {
    return ((const NNSG3dResAnmCommon *)anmObj->resAnm)->numFrame * FX32_ONE;
}

// A material color animation (BMA0): a dictionary of the data of each material it animates. A material's data has a
// word for each value it animates, its diffuse, ambient, specular and emission colors and its polygon alpha, which
// says how the values at the frames are kept (nsbma.c). With CONST the word's low half is the value itself. Otherwise
// it is the offset of an array of them from the animation, with a value for every frame, or with a step of two or
// four for every second or fourth, and the frames between are made from the stored ones up to LAST_INTERP, the last
// frame that is. A color is a GXRgb (RGB555) and the alpha a byte
typedef struct {
    NNSG3dResAnmHeader anmHeader;
    u16 numFrame;
    u16 flag;
    NNSG3dResDict dict;
} NNSG3dResMatCAnm;

typedef struct {
    u32 diffuse;
    u32 ambient;
    u32 specular;
    u32 emission;
    u32 polygon_alpha;
} NNSG3dResDictMatCAnmData;

#define NNS_G3D_MATCANM_ELEM_CONST 0x20000000
#define NNS_G3D_MATCANM_ELEM_STEP_1 0x00000000
#define NNS_G3D_MATCANM_ELEM_STEP_2 0x40000000
#define NNS_G3D_MATCANM_ELEM_STEP_4 0x80000000
#define NNS_G3D_MATCANM_ELEM_STEP_MASK 0xc0000000
#define NNS_G3D_MATCANM_ELEM_LAST_INTERP_MASK 0x1fff0000
#define NNS_G3D_MATCANM_ELEM_LAST_INTERP_SHIFT 16
#define NNS_G3D_MATCANM_ELEM_OFFSET_CONSTANT_MASK 0x0000ffff

// A texture SRT animation (BTA0): a dictionary of the data of each material it animates. A material's data says how
// the values of the parts of its texture matrix are kept (nsbta.c): the scale in S and T, the rotation, and the
// translation in S and T, each by an info word and a second word. As for the colors of a BMA0, the info says whether
// the values are constant, or have a step of two or four with the last frame that is interpolated, here in its low
// half, and FX16 says that they are fx16 rather than fx32. The second word is the value itself if CONST is set, or the
// offset of the values from the animation. A rotation is its sine and cosine, two fx16 that make a word, with the
// cosine in the high half
typedef struct {
    NNSG3dResAnmHeader anmHeader;
    u16 numFrame;
    u16 dummy_;
    NNSG3dResDict dict;
} NNSG3dResTexSRTAnm;

typedef struct {
    u32 info;
    u32 offset;
} NNSG3dResTexSrtAnmElem;

typedef struct {
    NNSG3dResTexSrtAnmElem scaleS;
    NNSG3dResTexSrtAnmElem scaleT;
    NNSG3dResTexSrtAnmElem rot;
    NNSG3dResTexSrtAnmElem transS;
    NNSG3dResTexSrtAnmElem transT;
} NNSG3dResDictTexSRTAnmData;

#define NNS_G3D_TEXSRTANM_ELEM_CONST 0x20000000
#define NNS_G3D_TEXSRTANM_ELEM_FX16 0x10000000
#define NNS_G3D_TEXSRTANM_ELEM_STEP_1 0x00000000
#define NNS_G3D_TEXSRTANM_ELEM_STEP_2 0x40000000
#define NNS_G3D_TEXSRTANM_ELEM_STEP_4 0x80000000
#define NNS_G3D_TEXSRTANM_ELEM_STEP_MASK 0xc0000000
#define NNS_G3D_TEXSRTANM_ELEM_LAST_INTERP_MASK 0x0000ffff

// A rotation of zero as the word of its sine and cosine: a sine of zero and a cosine of one
#define NNS_G3D_SRTANM_ROT_ZERO ((u32)FX16_ONE << 16)

// A visibility animation (BVA0): a bit for each node at each frame, the bits of a frame being those of numNode nodes
// after the bits of the frame before, and a set bit meaning the node shows
typedef struct {
    NNSG3dResAnmHeader anmHeader;
    u16 numFrame;
    u16 numNode;
    u16 size;
    u16 dummy_;
    u32 visData[1];
} NNSG3dResVisAnm;

// A texture pattern animation (BTP0): the names of its textures and palettes, then a dictionary of the data for each
// material it animates. A material's data says where its run of frame values is, in the animation, and how long it is:
// the frame values give the texture and palette to show from a frame on (idPltt is 0xff for none). ratioDataFrame is
// the number of frame values to a frame, in 1/4096ths, for finding the one at a frame without searching from the first
typedef struct {
    NNSG3dResAnmHeader anmHeader;
    u16 numFrame;
    u8 numTex;
    u8 numPltt;
    u16 ofsTexName;
    u16 ofsPlttName;
    NNSG3dResDict dict;
} NNSG3dResTexPatAnm;

typedef struct {
    u16 numFV;
    u16 flag;
    fx16 ratioDataFrame;
    u16 offset;
} NNSG3dResDictTexPatAnmData;

typedef struct {
    u16 idxFrame;
    u8 idTex;
    u8 idPltt;
} NNSG3dResTexPatAnmFV;

// A joint animation. Each joint's tag, at ofsTag[joint], is a word of NNS_G3D_JNTANM_SRTINFO_* flags followed by what
// the flags say the animation has of the joint's translation, rotation and scale: for a component that is neither the
// identity nor the node's own, either its value if it is constant, or a NNSG3dJntAnmTInfo that says where its values
// are. The constant of a rotation is an index of the rotation tables (ofsRot3 and ofsRot5, offsets from the animation),
// and that of a scale component is the scale and its inverse
typedef struct {
    NNSG3dResAnmHeader anmHeader;
    u16 numFrame;
    u16 numNode;
    u32 flag;
    u32 ofsRot3;
    u32 ofsRot5;
    u16 ofsTag[1];
} NNSG3dResJntAnm;

// The flag of a joint animation: INTERPOLATION blends the values of a frame with a fraction with those of the next
// frame, and END_TO_START does so for the last frame too, with the first
#define NNS_G3D_JNTANM_OPTION_INTERPOLATION 0x00000001
#define NNS_G3D_JNTANM_OPTION_END_TO_START_INTERPOLATION 0x00000002

#define NNS_G3D_JNTANM_SRTINFO_IDENTITY 0x00000001
#define NNS_G3D_JNTANM_SRTINFO_IDENTITY_T 0x00000002
#define NNS_G3D_JNTANM_SRTINFO_BASE_T 0x00000004
#define NNS_G3D_JNTANM_SRTINFO_CONST_TX 0x00000008
#define NNS_G3D_JNTANM_SRTINFO_CONST_TY 0x00000010
#define NNS_G3D_JNTANM_SRTINFO_CONST_TZ 0x00000020
#define NNS_G3D_JNTANM_SRTINFO_IDENTITY_R 0x00000040
#define NNS_G3D_JNTANM_SRTINFO_BASE_R 0x00000080
#define NNS_G3D_JNTANM_SRTINFO_CONST_R 0x00000100
#define NNS_G3D_JNTANM_SRTINFO_IDENTITY_S 0x00000200
#define NNS_G3D_JNTANM_SRTINFO_BASE_S 0x00000400
#define NNS_G3D_JNTANM_SRTINFO_CONST_SX 0x00000800
#define NNS_G3D_JNTANM_SRTINFO_CONST_SY 0x00001000
#define NNS_G3D_JNTANM_SRTINFO_CONST_SZ 0x00002000
#define NNS_G3D_JNTANM_SRTINFO_NODE_MASK 0xff000000
#define NNS_G3D_JNTANM_SRTINFO_NODE_SHIFT 24

// Where the values of a component are, and how they are kept: TINFO_* flags and the offset of the values from the
// animation. The values are for every frame, or with a step of two or four for every second or fourth, and the frames
// between are made from the stored ones up to LAST_INTERP, the last frame that is. A translation or scale component is
// kept in fx16 (FX16ARR) or in fx32, a rotation as the indices (u16) of rotations
#define NNS_G3D_JNTANM_TINFO_STEP_1 0x00000000
#define NNS_G3D_JNTANM_TINFO_STEP_2 0x40000000
#define NNS_G3D_JNTANM_TINFO_STEP_4 0x80000000
#define NNS_G3D_JNTANM_TINFO_STEP_MASK 0xc0000000
#define NNS_G3D_JNTANM_TINFO_FX16ARRAY 0x20000000
#define NNS_G3D_JNTANM_TINFO_LAST_INTERP_MASK 0x1fff0000
#define NNS_G3D_JNTANM_TINFO_LAST_INTERP_SHIFT 16

typedef struct {
    u32 info;
    u32 offset;
} NNSG3dJntAnmTInfo;

// A rotation index is that of a rotation of three values (a pivot and two numbers) or of five, in the table that
// ofsRot3 or ofsRot5 gives. The enum and its names are NitroSystem's, as Kingdom Hearts 358/2 Days' decompilation has
// them
typedef enum {
    NNS_G3D_JNTANM_RIDX_PIVOT = 0x8000,
    NNS_G3D_JNTANM_RIDX_IDXDATA_MASK = 0x7fff,
    NNS_G3D_JNTANM_RIDX_IDXDATA_SHIFT = 0
} NNSG3dJntAnmRIdx;

// The second category of an animation resource's header, which tells the kind of animation within what it animates
#define NNS_G3D_ANM_CATEGORY1_MA 'MA'
#define NNS_G3D_ANM_CATEGORY1_TP 'TP'
#define NNS_G3D_ANM_CATEGORY1_TA 'TA'
#define NNS_G3D_ANM_CATEGORY1_VA 'VA'
#define NNS_G3D_ANM_CATEGORY1_CA 'CA'

// What an animation computes for one material, joint or node. The function in an animation object's funcAnm fills one
// in from the data at the index of the animation's own data that mapData gives, and a blend combines the results of all
// the animation objects of a list. The material's is shared by the material, texture SRT and texture pattern
// animations

// A material's result is what the geometry engine gets for it: the colors, polygon attribute, texture and palette, and
// the texture matrix's scale, rotation as a sine and cosine, and translation. Its flag says which of the matrix's parts
// were set: when a part is the identity, the flag says so and leaves its values alone. The texture matrix is made when
// TEXMTX_SET or TEXMTX_MULT is set, and the original size and magnification of the texture are the material's
typedef enum {
    NNS_G3D_MATANM_RESULTFLAG_TEXMTX_SCALEONE = 0x00000001,
    NNS_G3D_MATANM_RESULTFLAG_TEXMTX_ROTZERO = 0x00000002,
    NNS_G3D_MATANM_RESULTFLAG_TEXMTX_TRANSZERO = 0x00000004,
    NNS_G3D_MATANM_RESULTFLAG_TEXMTX_SET = 0x00000008,
    NNS_G3D_MATANM_RESULTFLAG_TEXMTX_MULT = 0x00000010,
    NNS_G3D_MATANM_RESULTFLAG_WIREFRAME = 0x00000020,
} NNSG3dMatAnmResultFlag;

typedef struct NNSG3dMatAnmResult {
    NNSG3dMatAnmResultFlag flag;
    u32 prmMatColor0;
    u32 prmMatColor1;
    u32 prmPolygonAttr;
    u32 prmTexImage;
    u32 prmTexPltt;
    fx32 scaleS;
    fx32 scaleT;
    fx16 sinR;
    fx16 cosR;
    fx32 transS;
    fx32 transT;
    u16 origWidth;
    u16 origHeight;
    fx32 magW;
    fx32 magH;
} NNSG3dMatAnmResult;

// A joint's flag says which of its parts are the identity: a scale of one, a zero rotation or translation. A blend
// keeps only those that all its animations have. The rotation is three rows of a matrix, of which a blend adds up the
// first two and makes the third. The scaling rules of Maya and Softimage models (maya.c and si3d.c) use the rest:
// scaleEx0 and scaleEx1 are the scale of the parent and its inverse (Softimage), or scaleEx0 the inverse of the
// parent's scale (Maya), where the joint is to cancel the scale of its parent, and EX0_ONE and EX1_ONE say that they
// are one. MAYA_SSC_APPLY is Maya's segment scale compensate: the joint cancels the scale of its parent
typedef enum {
    NNS_G3D_JNTANM_RESULTFLAG_SCALE_ONE = 0x00000001,
    NNS_G3D_JNTANM_RESULTFLAG_ROT_ZERO = 0x00000002,
    NNS_G3D_JNTANM_RESULTFLAG_TRANS_ZERO = 0x00000004,
    NNS_G3D_JNTANM_RESULTFLAG_SCALEEX0_ONE = 0x00000008,
    NNS_G3D_JNTANM_RESULTFLAG_SCALEEX1_ONE = 0x00000010,
    NNS_G3D_JNTANM_RESULTFLAG_MAYA_SSC = 0x00000020,
} NNSG3dJntAnmResultFlag;

typedef struct {
    NNSG3dJntAnmResultFlag flag;
    VecFx32 scale;
    VecFx32 scaleEx0;
    VecFx32 scaleEx1;
    union {
        MtxFx33 rot;
        VecFx32 rotRow[3];
        fx32 rotElem[9];
    };
    VecFx32 trans;
} NNSG3dJntAnmResult;

typedef struct {
    BOOL isVisible;
} NNSG3dVisAnmResult;

typedef void (*NNSG3dFuncAnmMat)(NNSG3dMatAnmResult *result, const NNSG3dAnmObj *anmObj, u32 dataIdx);
typedef void (*NNSG3dFuncAnmJnt)(NNSG3dJntAnmResult *result, const NNSG3dAnmObj *anmObj, u32 dataIdx);
typedef void (*NNSG3dFuncAnmVis)(NNSG3dVisAnmResult *result, const NNSG3dAnmObj *anmObj, u32 dataIdx);

// What combines the animations of a render object's list for a material or node, and returns whether any had data for
// it
typedef BOOL (*NNSG3dFuncAnmBlendMat)(NNSG3dMatAnmResult *result, const NNSG3dAnmObj *anmObj, u32 matID);
typedef BOOL (*NNSG3dFuncAnmBlendJnt)(NNSG3dJntAnmResult *result, const NNSG3dAnmObj *anmObj, u32 nodeID);
typedef BOOL (*NNSG3dFuncAnmBlendVis)(NNSG3dVisAnmResult *result, const NNSG3dAnmObj *anmObj, u32 nodeID);

// The flag of a render object. HINT_OBSOLETE is set when its animations changed, so that its hints are out of date. The
// others set the options of the same name in the render state that draws it (NNS_G3D_RSFLAG_OPT_*)
#define NNS_G3D_RENDEROBJ_FLAG_RECORD 0x00000001
#define NNS_G3D_RENDEROBJ_FLAG_NOGECMD 0x00000002
#define NNS_G3D_RENDEROBJ_FLAG_SKIP_SBC_DRAW 0x00000004
#define NNS_G3D_RENDEROBJ_FLAG_SKIP_SBC_MTXCALC 0x00000008
#define NNS_G3D_RENDEROBJ_FLAG_HINT_OBSOLETE 0x00000010

// The render state that draws a model (below). A callback gets it when the command of cbCmd runs, at the time cbTiming
// says, and cbInitFunc gets it before the first command
typedef struct NNSG3dRS NNSG3dRS;
typedef void (*NNSG3dSbcCallBackFunc)(NNSG3dRS *rs);

// What draws a model, 0x54 bytes. The animations bound to it are in three lists by what they animate, and hint*Exist
// has a bit for each material or node that one of them has data for. ptrUserSbc replaces the model's own commands.
// recJntAnm and recMatAnm are where the results of the joints and materials are recorded, one for each
typedef struct {
    u32 flag;
    NNSG3dResMdl *resMdl;
    NNSG3dAnmObj *anmMat;
    NNSG3dFuncAnmBlendMat funcBlendMat;
    NNSG3dAnmObj *anmJnt;
    NNSG3dFuncAnmBlendJnt funcBlendJnt;
    NNSG3dAnmObj *anmVis;
    NNSG3dFuncAnmBlendVis funcBlendVis;
    NNSG3dSbcCallBackFunc cbFunc;
    u8 cbCmd;
    u8 cbTiming;
    u16 dummy_;
    NNSG3dSbcCallBackFunc cbInitFunc;
    void *ptrUser;
    u8 *ptrUserSbc;
    NNSG3dJntAnmResult *recJntAnm;
    NNSG3dMatAnmResult *recMatAnm;
    u32 hintMatAnmExist[2];
    u32 hintJntAnmExist[2];
    u32 hintVisAnmExist[2];
} NNSG3dRenderObj;

// The blocks of a file (res_struct_accessor.c), and the animations of an animation file by their index
// (res_struct_accessor_anm.c)
NNSG3dResMdlSet *NNS_G3dGetMdlSet(const NNSG3dResFileHeader *header); // swan's NNS_G3DResGetMdlBlock
NNSG3dResTex *NNS_G3dGetTex(const NNSG3dResFileHeader *header);       // swan's NNS_G3DResGetTexBlock
void *NNS_G3dGetAnmByIdx(const void *header, u32 idx);                // swan's NNS_G3DResGetAnm

// The name of a dictionary entry, padded to sixteen characters with zeros
typedef union {
    char name[16];
    u32 val[4];
} NNSG3dResName;

// The data of the dictionary's entry of the name, or NULL (swan's NNS_G3DFind)
void *NNS_G3dGetResDataByName(const NNSG3dResDict *dict, const NNSG3dResName *name);
// The index of the dictionary's entry of the name, or -1 (swan's NNS_G3DFindIndex)
int NNS_G3dGetResDictIdxByName(const NNSG3dResDict *dict, const NNSG3dResName *name);

static inline const NNSG3dResName *NNS_G3dGetResNameByIdx(const NNSG3dResDict *dict, u32 idx) {
    if (dict != NULL && idx < dict->numEntry) {
        const NNSG3dResDictEntryHeader *hdr = (const NNSG3dResDictEntryHeader *)((u8 *)dict + dict->ofsEntry);

        return (const NNSG3dResName *)((u8 *)hdr + hdr->ofsName) + idx;
    }
    return NULL;
}

// The data of a texture block's dictionary entry: the texture's GX_TEXIMAGE_PARAM, with its offset in the low bits, and
// the texture's original width and height in extraParam
#define NNS_G3D_TEXIMAGE_PARAMEX_ORIGW_MASK 0x000007ff
#define NNS_G3D_TEXIMAGE_PARAMEX_ORIGH_MASK 0x003ff800
#define NNS_G3D_TEXIMAGE_PARAMEX_ORIGH_SHIFT 11

typedef struct {
    u32 texImageParam;
    u32 extraParam;
} NNSG3dResDictTexData;

// The data of a palette dictionary entry: the palette's offset in 8-byte units, and whether it is a 4-color palette
#define NNS_G3D_RESDICTPLTT_USEPLTT4 0x0001

typedef struct {
    u16 offset;
    u16 flag;
} NNSG3dResDictPlttData;

// A texture pattern animation's names of a texture and of a palette, or NULL past the last, and the texture and palette
// that its material shows at a frame, which the frame values of the material at idx say
const NNSG3dResName *NNSi_G3dGetTexPatAnmTexNameByIdx(const NNSG3dResTexPatAnm *anm, u8 idx);
const NNSG3dResName *NNSi_G3dGetTexPatAnmPlttNameByIdx(const NNSG3dResTexPatAnm *anm, u8 idx);
const NNSG3dResTexPatAnmFV *NNSi_G3dGetTexPatAnmFV(const NNSG3dResTexPatAnm *anm, u32 idx, u32 frame);

// Textures and palettes in VRAM (kernel.c). swan calls NNS_G3dTexGetRequiredSize NNS_G3DResTexGetTexDataSize,
// NNS_G3dTexSetTexKey NNS_G3DResTexSetGfdKeys, NNS_G3dTexLoad NNS_G3DResTexUploadTex, NNS_G3dPlttGetRequiredSize
// NNS_G3DResTexGetPaletteDataSize, NNS_G3dPlttSetPlttKey NNS_G3DResTexSetPltGfdKey and NNS_G3dPlttLoad
// NNS_G3DResTexUploadPlt
u32 NNS_G3dTexGetRequiredSize(const NNSG3dResTex *tex);
u32 NNS_G3dTex4x4GetRequiredSize(const NNSG3dResTex *tex);
void NNS_G3dTexSetTexKey(NNSG3dResTex *tex, NNSGfdTexKey key, NNSGfdTexKey key4x4);
void NNS_G3dTexLoad(NNSG3dResTex *tex, BOOL exec_begin_end);
void NNS_G3dTexReleaseTexKey(NNSG3dResTex *tex, NNSGfdTexKey *key, NNSGfdTexKey *key4x4);
u32 NNS_G3dPlttGetRequiredSize(const NNSG3dResTex *tex);
void NNS_G3dPlttSetPlttKey(NNSG3dResTex *tex, NNSGfdPlttKey plttKey);
void NNS_G3dPlttLoad(NNSG3dResTex *tex, BOOL exec_begin_end);
NNSGfdPlttKey NNS_G3dPlttReleasePlttKey(NNSG3dResTex *tex);

// Binding a model's materials to a texture block's textures and palettes by name, which sets what the materials draw
// with. Both return FALSE if a name of the model is not in the texture block. A texture or palette that is bound
// already is left alone
BOOL NNS_G3dBindMdlTex(NNSG3dResMdl *mdl, const NNSG3dResTex *tex);
BOOL NNS_G3dBindMdlPltt(NNSG3dResMdl *mdl, const NNSG3dResTex *tex);
// Binds the palette at plttNameIdx of the texture block to the materials of the palette-to-material entry
// plttToMatListIdx, unless that entry is bound already, and returns whether it did. NNS_G3dReleaseMdlPltt clears the
// bound mark of every palette-to-material entry, so that they can be bound again
BOOL NNS_G3dForceBindMdlPltt(NNSG3dResMdl *mdl, const NNSG3dResTex *tex, u32 plttToMatListIdx, u32 plttNameIdx);
void NNS_G3dReleaseMdlPltt(NNSG3dResMdl *mdl);

// Render and animation objects, and drawing a render object. swan calls NNS_G3dRenderObjInit
// NNS_G3DModelAttachResource, NNS_G3dAllocAnmObj NNS_G3DAnimationAlloc, NNS_G3dAnmObjCalcSizeRequired
// NNS_G3DAnimationCalcAllocSize, NNS_G3dAnmObjInit NNS_G3DAnimationCreate, NNS_G3dRenderObjAddAnmObj
// NNS_G3DAnimationBind and NNS_G3dDraw NNS_G3DDraw
NNSG3dRenderObj *NNS_G3dAllocRenderObj(NNSFndAllocator *allocator);
void NNS_G3dFreeRenderObj(NNSFndAllocator *allocator, NNSG3dRenderObj *obj);
void NNS_G3dRenderObjInit(NNSG3dRenderObj *obj, NNSG3dResMdl *mdl);
NNSG3dAnmObj *NNS_G3dAllocAnmObj(NNSFndAllocator *allocator, const void *anm, const NNSG3dResMdl *mdl);
u32 NNS_G3dAnmObjCalcSizeRequired(const void *anm, const NNSG3dResMdl *mdl);
void NNS_G3dFreeAnmObj(NNSFndAllocator *allocator, NNSG3dAnmObj *anmObj);
void NNS_G3dAnmObjInit(NNSG3dAnmObj *anmObj, void *anm, const NNSG3dResMdl *mdl, const NNSG3dResTex *tex);
void NNS_G3dRenderObjAddAnmObj(NNSG3dRenderObj *obj, NNSG3dAnmObj *anmObj);
void NNS_G3dRenderObjRemoveAnmObj(NNSG3dRenderObj *obj, NNSG3dAnmObj *anmObj);
void NNS_G3dDraw(NNSG3dRenderObj *obj);

// What starts an animation of a kind of resource: its header, and the function that fills in the animation object
typedef void (*NNSG3dAnimInitFunc)(NNSG3dAnmObj *anmObj, void *anm, const NNSG3dResMdl *mdl);

typedef struct {
    NNSG3dResAnmHeader header;
    NNSG3dAnimInitFunc init;
} NNSG3dAnmObjInitFunc;

// The table that NNS_G3dAnmObjInit searches for the kind of animation it is given, and how many of its entries are
// in use (anm.c)
extern u32 NNS_G3dAnmFmtNum;                              // swan's NNS_G3D_ANIMATION_INIT_HEADER_COUNT
extern NNSG3dAnmObjInitFunc NNS_G3dAnmObjInitFuncArray[]; // swan's NNS_G3D_ANIMATION_INIT_HEADERS
// The function that fills in an animation object of each kind, and the function the object holds, which its init
// function copies to funcAnm from the variables after them (nsbma.c, nsbtp.c, nsbta.c, nsbva.c, nsbca.c and anm.c).
// swan calls NNSi_G3dAnmObjInitNsBta, NNSi_G3dAnmObjInitNsBtp and NNSi_G3dAnmCalcNsBca NNS_G3DAnimationInit_TA,
// NNS_G3DAnimationInit_TP and NNS_G3DAnimationApply_CA
void NNSi_G3dAnmObjInitNsBma(NNSG3dAnmObj *anmObj, void *anm, const NNSG3dResMdl *mdl);
void NNSi_G3dAnmObjInitNsBtp(NNSG3dAnmObj *anmObj, void *anm, const NNSG3dResMdl *mdl);
void NNSi_G3dAnmObjInitNsBta(NNSG3dAnmObj *anmObj, void *anm, const NNSG3dResMdl *mdl);
void NNSi_G3dAnmObjInitNsBva(NNSG3dAnmObj *anmObj, void *anm, const NNSG3dResMdl *mdl);
void NNSi_G3dAnmObjInitNsBca(NNSG3dAnmObj *anmObj, void *anm, const NNSG3dResMdl *mdl);
void NNSi_G3dAnmCalcNsBma(NNSG3dMatAnmResult *result, const NNSG3dAnmObj *anmObj, u32 dataIdx);
void NNSi_G3dAnmCalcNsBta(NNSG3dMatAnmResult *result, const NNSG3dAnmObj *anmObj, u32 dataIdx);
void NNSi_G3dAnmCalcNsBtp(NNSG3dMatAnmResult *result, const NNSG3dAnmObj *anmObj, u32 dataIdx);
void NNSi_G3dAnmCalcNsBva(NNSG3dVisAnmResult *result, const NNSG3dAnmObj *anmObj, u32 dataIdx);
void NNSi_G3dAnmCalcNsBca(NNSG3dJntAnmResult *result, const NNSG3dAnmObj *anmObj, u32 dataIdx);
extern NNSG3dFuncAnmVis NNS_G3dFuncAnmVisNsBvaDefault;
extern NNSG3dFuncAnmJnt NNS_G3dFuncAnmJntNsBcaDefault;
extern NNSG3dFuncAnmMat NNS_G3dFuncAnmMatNsBtaDefault;
extern NNSG3dFuncAnmMat NNS_G3dFuncAnmMatNsBtpDefault;
extern NNSG3dFuncAnmMat NNS_G3dFuncAnmMatNsBmaDefault;

// The functions that combine the animations of a render object, for its materials, joints and visibility. The variables
// after them are what NNS_G3dRenderObjInit copies to funcBlendMat, funcBlendJnt and funcBlendVis (anm.c)
BOOL NNSi_G3dAnmBlendMat(NNSG3dMatAnmResult *result, const NNSG3dAnmObj *anmObj, u32 matID);
BOOL NNSi_G3dAnmBlendJnt(NNSG3dJntAnmResult *result, const NNSG3dAnmObj *anmObj, u32 nodeID);
BOOL NNSi_G3dAnmBlendVis(NNSG3dVisAnmResult *result, const NNSG3dAnmObj *anmObj, u32 nodeID);
extern NNSG3dFuncAnmBlendMat NNS_G3dFuncBlendMatDefault;
extern NNSG3dFuncAnmBlendJnt NNS_G3dFuncBlendJntDefault;
extern NNSG3dFuncAnmBlendVis NNS_G3dFuncBlendVisDefault;

// A scale and its inverse: a node's, as a scale function reads them, and each joint's of the model being drawn, which
// the scaling rules (maya.c and si3d.c) keep for the joints below it in NNS_G3dRSOnGlb
typedef struct {
    VecFx32 scale;
    VecFx32 invScale;
} NNSG3dJointScale;

// The functions that a model's scaling rule and texture matrix mode choose between when it is drawn, in tables indexed
// by the rule or the mode (cgtool.c). A flush sends a joint's result to the geometry engine: its scale, rotation and
// translation, as the result's flag leaves them. A scale function sets the scale parts of a joint's result from the
// scale of the node, its scale and inverse scale (six fx32, as in an NNSG3dJointScale), the node's command in the
// stream and its flags, where bit 2 is a scale of one. A texture matrix function sends the texture matrix of a
// material's result; XSI's sets the identity values into the result first, through a cast that drops the const
typedef void (*NNSG3dSendJointSRT)(const NNSG3dJntAnmResult *result);
typedef void (*NNSG3dGetJointScale)(NNSG3dJntAnmResult *result, const fx32 *p, const u8 *cmd, u32 srtFlag);
typedef void (*NNSG3dSendTexSRT)(const NNSG3dMatAnmResult *result);

// Standard (basic.c), Maya (maya.c) and Softimage (si3d.c) scaling rules
void NNSi_G3dSendJointSRTBasic(const NNSG3dJntAnmResult *result);
void NNSi_G3dSendJointSRTMaya(const NNSG3dJntAnmResult *result);
void NNSi_G3dSendJointSRTSi3d(const NNSG3dJntAnmResult *result);
void NNSi_G3dGetJointScaleBasic(NNSG3dJntAnmResult *result, const fx32 *p, const u8 *cmd, u32 srtFlag);
void NNSi_G3dGetJointScaleMaya(NNSG3dJntAnmResult *result, const fx32 *p, const u8 *cmd, u32 srtFlag);
void NNSi_G3dGetJointScaleSi3d(NNSG3dJntAnmResult *result, const fx32 *p, const u8 *cmd, u32 srtFlag);
// Maya (maya.c), Softimage (si3d.c), 3ds Max (3dsmax.c) and XSI (xsi.c) texture matrix modes
void NNSi_G3dSendTexSRTMaya(const NNSG3dMatAnmResult *result);
void NNSi_G3dSendTexSRTSi3d(const NNSG3dMatAnmResult *result);
void NNSi_G3dSendTexSRT3dsMax(const NNSG3dMatAnmResult *result);
void NNSi_G3dSendTexSRTXsi(const NNSG3dMatAnmResult *result);

extern NNSG3dSendJointSRT NNS_G3dSendJointSRT_FuncArray[3];   // swan's NNS_G3D_JOINT_FLUSH_FUNCS
extern NNSG3dGetJointScale NNS_G3dGetJointScale_FuncArray[3]; // swan's NNS_G3D_JOINT_SCALE_FUNCS
extern NNSG3dSendTexSRT NNS_G3dSendTexSRT_FuncArray[4];       // swan's NNS_G3D_TEX_MATRIX_FUNCS

// The buffer that geometry commands wait in while a display list is on its way by DMA, and sending a command or a
// display list (gecom.c)
#define NNS_G3D_SIZE_COMBUFFER 192

// The commands that wait for the DMA: the number of words, then the words as the FIFO takes them (each command, then
// its parameters)
typedef struct {
    u32 idx;
    u32 data[NNS_G3D_SIZE_COMBUFFER];
} NNSG3dGeBuffer;

BOOL NNS_G3dGeIsBufferExist(void);
void NNS_G3dGeSetBuffer(NNSG3dGeBuffer *buffer);
NNSG3dGeBuffer *NNS_G3dGeReleaseBuffer(void);
void NNS_G3dGeFlushBuffer(void);                            // swan's NNS_G3DWaitFIFO
void NNS_G3dGeBufferOP_N(u32 op, const u32 *args, u32 num); // swan's NNS_G3DExecOp
void NNS_G3dGeSendDL(const void *list, u32 size);           // swan's NNS_G3DExecDisplayList
// Whether NNS_G3dGeSendDL sends by the SDK's fast DMA rather than the one that waits for the FIFO
extern u32 NNS_G3dFlagUseFastDma;
// Gets the position matrix and the vector matrix that the geometry engine is at, each unless its pointer is null
void NNS_G3dGetCurrentMtx(MtxFx43 *pos, MtxFx33 *nrm); // swan's NNS_G3DGetTransforms

// NitroSystem's inline wrappers of the buffer, one per geometry command
static inline void NNS_G3dGePushMtx(void) {
    NNS_G3dGeBufferOP_N(G3OP_MTX_PUSH, NULL, 0);
}

static inline void NNS_G3dGePopMtx(int num) {
    s32 param = num;

    NNS_G3dGeBufferOP_N(G3OP_MTX_POP, (const u32 *)&param, 1);
}

static inline void NNS_G3dGeMtxMode(GXMtxMode mode) {
    u32 param = mode;

    NNS_G3dGeBufferOP_N(G3OP_MTX_MODE, &param, 1);
}

static inline void NNS_G3dGeStoreMtx(int idx) {
    u32 param = idx;

    NNS_G3dGeBufferOP_N(G3OP_MTX_STORE, &param, 1);
}

static inline void NNS_G3dGeRestoreMtx(int idx) {
    u32 param = idx;

    NNS_G3dGeBufferOP_N(G3OP_MTX_RESTORE, &param, 1);
}

static inline void NNS_G3dGeIdentity(void) {
    NNS_G3dGeBufferOP_N(G3OP_MTX_IDENTITY, NULL, 0);
}

static inline void NNS_G3dGeLoadMtx44(const MtxFx44 *mtx) {
    NNS_G3dGeBufferOP_N(G3OP_MTX_LOAD_4x4, (const u32 *)mtx, 16);
}

static inline void NNS_G3dGeLoadMtx43(const MtxFx43 *mtx) {
    NNS_G3dGeBufferOP_N(G3OP_MTX_LOAD_4x3, (const u32 *)mtx, 12);
}

static inline void NNS_G3dGeMultMtx44(const MtxFx44 *mtx) {
    NNS_G3dGeBufferOP_N(G3OP_MTX_MULT_4x4, (const u32 *)mtx, 16);
}

static inline void NNS_G3dGeMultMtx43(const MtxFx43 *mtx) {
    NNS_G3dGeBufferOP_N(G3OP_MTX_MULT_4x3, (const u32 *)mtx, 12);
}

static inline void NNS_G3dGeMultMtx33(const MtxFx33 *mtx) {
    NNS_G3dGeBufferOP_N(G3OP_MTX_MULT_3x3, (const u32 *)mtx, 9);
}

static inline void NNS_G3dGeScaleVec(const VecFx32 *scale) {
    NNS_G3dGeBufferOP_N(G3OP_MTX_SCALE, (const u32 *)scale, 3);
}

static inline void NNS_G3dGeTranslateVec(const VecFx32 *trans) {
    NNS_G3dGeBufferOP_N(G3OP_MTX_TRANS, (const u32 *)trans, 3);
}

static inline void NNS_G3dGeTexCoord(fx32 s, fx32 t) {
    u32 param = GX_ST(s, t);

    NNS_G3dGeBufferOP_N(G3OP_TEXCOORD, &param, 1);
}

static inline void NNS_G3dGePolygonAttr(int light, GXPolygonMode polyMode, GXCull cullMode, int polygonID, int alpha,
                                        int misc) {
    u32 param = GX_PACK_POLYGONATTR_PARAM(light, polyMode, cullMode, polygonID, alpha, misc);

    NNS_G3dGeBufferOP_N(G3OP_POLYGON_ATTR, &param, 1);
}

static inline void NNS_G3dGeBegin(GXBegin primitive) {
    u32 param = primitive;

    NNS_G3dGeBufferOP_N(G3OP_BEGIN, &param, 1);
}

static inline void NNS_G3dGeEnd(void) {
    NNS_G3dGeBufferOP_N(G3OP_END, NULL, 0);
}

static inline void NNS_G3dGeBoxTest(const GXBoxTestParam *box) {
    NNS_G3dGeBufferOP_N(G3OP_BOX_TEST, (const u32 *)box, 3);
}

// The global state of the geometry engine. The cmd words hold the geometry commands that send what follows them, so
// that a flush is one run of the structure
typedef struct {
    u32 cmd0;
    u32 mtxmode_proj;
    MtxFx44 projMtx;
    u32 mtxmode_posvec;
    // The camera matrix, which is also its rotation followed by its translation
    union {
        MtxFx43 cameraMtx;
        struct {
            MtxFx33 cameraRot;
            VecFx32 cameraTrans;
        };
    };
    u32 cmd1;
    u32 lightVec[4];
    u32 cmd2;
    u32 prmMatColor0;
    u32 prmMatColor1;
    u32 prmPolygonAttr;
    u32 prmViewPort;
    u32 cmd3;
    u32 lightColor[4];
    u32 cmd4;
    // The base transformation of the models: the rotation and translation, which are also one 4x3 matrix, and the scale
    union {
        MtxFx43 prmBaseMtx;
        struct {
            MtxFx33 prmBaseRot;
            VecFx32 prmBaseTrans;
        };
    };
    VecFx32 prmBaseScale;
    u32 prmTexImageParam;
    u32 flag;
    // The matrices that are made as needed, each with the flag that says it is up to date: the inverse of the camera
    // matrix (INVCAMERA), the base transformation applied to the camera matrix (BASECAMERA) and its inverse (made with
    // it), the inverse of the base transformation (INVBASE, which no code reads), the inverse of the projection matrix
    // (INVPROJ), and the inverse of the camera and projection matrices together (INVCAMERAPROJ)
    MtxFx43 invCameraMtx;
    MtxFx43 srtCameraMtx;
    MtxFx43 invSrtCameraMtx;
    MtxFx43 invBaseMtx;
    MtxFx44 invProjMtx;
    MtxFx44 invCameraProjMtx;
    // Where NNS_G3dGlbLookAt last put the camera
    VecFx32 camPos;
    VecFx32 camUp;
    VecFx32 camTarget;
} NNSG3dGlb;

// What the last flush sent: with neither flag, the projection matrix alone, the camera and the base transformation
// going to the position matrix; with FLUSH_VP, the camera joins the projection matrix; with FLUSH_WVP, so does the base
// transformation. The flush functions set and clear them
#define NNS_G3D_GLB_FLAG_FLUSH_WVP 0x00000001
#define NNS_G3D_GLB_FLAG_FLUSH_VP 0x00000002
#define NNS_G3D_GLB_FLAG_INVBASE_UPTODATE 0x00000004
#define NNS_G3D_GLB_FLAG_INVCAMERA_UPTODATE 0x00000008
#define NNS_G3D_GLB_FLAG_INVPROJ_UPTODATE 0x00000010
#define NNS_G3D_GLB_FLAG_INVBASECAMERA_UPTODATE 0x00000020
#define NNS_G3D_GLB_FLAG_INVCAMERAPROJ_UPTODATE 0x00000040
#define NNS_G3D_GLB_FLAG_BASECAMERA_UPTODATE 0x00000080

extern NNSG3dGlb NNS_G3dGlb;

// NNS_G3dInit (util.c), and the setup of the global state (glbstate.c)
void NNS_G3dInit(void);                            // swan's NNS_G3DInit
void NNS_G3dGlbInit(void);                         // swan's NNS_G3DRenderStateInit
void NNS_G3dGlbSetBaseTrans(const VecFx32 *trans); // swan's NNS_G3DRenderTranslationSet
void NNS_G3dGlbSetBaseScale(const VecFx32 *scale); // swan's NNS_G3DRenderScaleSet
// Set a light's direction or color in the global state
void NNS_G3dGlbLightVector(GXLightId lightID, fx16 x, fx16 y, fx16 z); // swan's NNS_G3DSetLightVector
void NNS_G3dGlbLightColor(GXLightId lightID, GXRgb rgb);               // swan's NNS_G3DSetLightColor
// Set the material colors in the global state
void NNS_G3dGlbMaterialColorDiffAmb(GXRgb diffuse, GXRgb ambient, BOOL isSetVtxColor); // swan's NNS_G3DSetMatDifAmb
void NNS_G3dGlbMaterialColorSpecEmi(GXRgb specular, GXRgb emission, BOOL isShininess); // swan's NNS_G3DSetMatSpeEmi
// Send the global state with the projection matrix, the view and projection, or the base, view and projection
void NNS_G3dGlbFlushP(void);   // swan's NNS_G3DFlushRenderState
void NNS_G3dGlbFlushVP(void);  // swan's NNS_G3DFlushViewProjection
void NNS_G3dGlbFlushWVP(void); // swan's NNS_G3DFlushModelViewProjection

// The inverse of the camera matrix; the base transformation applied to the camera matrix (the model view matrix of a
// model drawn at the origin) and its inverse; and the inverse of the camera and projection matrices together. Each is
// made when it is first asked for after what it depends on changed, and the pointers are into NNS_G3dGlb
const MtxFx43 *NNS_G3dGlbGetInvV(void);  // swan's NNS_G3DGetInvViewMatrix
const MtxFx43 *NNS_G3dGlbGetWV(void);    // swan's NNS_G3DGetTempMVMatrix
const MtxFx43 *NNS_G3dGlbGetInvWV(void); // swan's NNS_G3DGetTempInvMVMatrix
const MtxFx44 *NNS_G3dGlbGetInvVP(void);
// The viewport that the global state holds; a null pointer leaves its value out
void NNS_G3dGlbGetViewPort(int *x1, int *y1, int *x2, int *y2); // swan's NNS_G3DGetViewport

static inline void NNS_G3dGlbFlush(void) {
    NNS_G3dGlbFlushP();
}

static inline void NNS_G3dGlbSetBaseRot(const MtxFx33 *rot) {
    MI_Copy36B(rot, &NNS_G3dGlb.prmBaseRot);
    NNS_G3dGlb.flag &= ~(NNS_G3D_GLB_FLAG_BASECAMERA_UPTODATE | NNS_G3D_GLB_FLAG_INVBASE_UPTODATE |
                         NNS_G3D_GLB_FLAG_INVBASECAMERA_UPTODATE);
}

static inline const MtxFx44 *NNS_G3dGlbGetProjectionMtx(void) {
    return &NNS_G3dGlb.projMtx;
}

static inline void NNS_G3dGlbSetProjectionMtx(const MtxFx44 *mtx) {
    MIi_CpuCopyFast(mtx, &NNS_G3dGlb.projMtx, sizeof(MtxFx44));
    NNS_G3dGlb.flag &= ~(NNS_G3D_GLB_FLAG_INVPROJ_UPTODATE | NNS_G3D_GLB_FLAG_INVCAMERAPROJ_UPTODATE);
}

static inline void NNS_G3dGlbPerspectiveW(fx32 fovySin, fx32 fovyCos, fx32 aspect, fx32 n, fx32 f, fx32 scaleW) {
    MTX_PerspectiveW(fovySin, fovyCos, aspect, n, f, scaleW, &NNS_G3dGlb.projMtx);
    NNS_G3dGlb.flag &= ~(NNS_G3D_GLB_FLAG_INVPROJ_UPTODATE | NNS_G3D_GLB_FLAG_INVCAMERAPROJ_UPTODATE);
}

static inline void NNS_G3dGlbPerspective(fx32 fovySin, fx32 fovyCos, fx32 aspect, fx32 n, fx32 f) {
    NNS_G3dGlbPerspectiveW(fovySin, fovyCos, aspect, n, f, FX32_ONE);
}

static inline void NNS_G3dGlbFrustumW(fx32 t, fx32 b, fx32 l, fx32 r, fx32 n, fx32 f, fx32 scaleW) {
    MTX_FrustumW(t, b, l, r, n, f, scaleW, &NNS_G3dGlb.projMtx);
    NNS_G3dGlb.flag &= ~(NNS_G3D_GLB_FLAG_INVPROJ_UPTODATE | NNS_G3D_GLB_FLAG_INVCAMERAPROJ_UPTODATE);
}

static inline void NNS_G3dGlbFrustum(fx32 t, fx32 b, fx32 l, fx32 r, fx32 n, fx32 f) {
    NNS_G3dGlbFrustumW(t, b, l, r, n, f, FX32_ONE);
}

static inline void NNS_G3dGlbOrthoW(fx32 t, fx32 b, fx32 l, fx32 r, fx32 n, fx32 f, fx32 scaleW) {
    MTX_OrthoW(t, b, l, r, n, f, scaleW, &NNS_G3dGlb.projMtx);
    NNS_G3dGlb.flag &= ~(NNS_G3D_GLB_FLAG_INVPROJ_UPTODATE | NNS_G3D_GLB_FLAG_INVCAMERAPROJ_UPTODATE);
}

static inline void NNS_G3dGlbOrtho(fx32 t, fx32 b, fx32 l, fx32 r, fx32 n, fx32 f) {
    NNS_G3dGlbOrthoW(t, b, l, r, n, f, FX32_ONE);
}

static inline void NNS_G3dGlbLookAt(const VecFx32 *camPos, const VecFx32 *camUp, const VecFx32 *target) {
    NNS_G3dGlb.camPos = *camPos;
    NNS_G3dGlb.camUp = *camUp;
    NNS_G3dGlb.camTarget = *target;
    MTX_LookAt(camPos, camUp, target, &NNS_G3dGlb.cameraMtx);
    NNS_G3dGlb.flag &= ~(NNS_G3D_GLB_FLAG_INVCAMERA_UPTODATE | NNS_G3D_GLB_FLAG_INVBASECAMERA_UPTODATE |
                         NNS_G3D_GLB_FLAG_INVCAMERAPROJ_UPTODATE | NNS_G3D_GLB_FLAG_BASECAMERA_UPTODATE);
}

// The render state of a model being drawn, and the commands that draw it. A model's byte code is a stream of commands
// (NNS_G3D_SBC_*), each a byte with the command in its low five bits and an option (NNS_G3D_SBCFLG_*) in its high
// three, followed by the command's arguments. NNS_G3dFuncSbcTable has the function of each command, which gets the
// render state and the option. The state is what the commands share: where they are in the stream, what has been set
// for the node and material being drawn, the callbacks of the render object, and the results that the animations give
// for the material, joint and visibility
#define NNS_G3D_SBC_NOP 0x00
#define NNS_G3D_SBC_RET 0x01
#define NNS_G3D_SBC_NODE 0x02
#define NNS_G3D_SBC_MTX 0x03
#define NNS_G3D_SBC_MAT 0x04
#define NNS_G3D_SBC_SHP 0x05
#define NNS_G3D_SBC_NODEDESC 0x06
#define NNS_G3D_SBC_BB 0x07
#define NNS_G3D_SBC_BBY 0x08
#define NNS_G3D_SBC_NODEMIX 0x09
#define NNS_G3D_SBC_CALLDL 0x0a
#define NNS_G3D_SBC_POSSCALE 0x0b
#define NNS_G3D_SBC_ENVMAP 0x0c
#define NNS_G3D_SBC_PRJMAP 0x0d
#define NNS_G3D_SBC_COMMAND_NUM 32

// The flags in the fourth byte of a NODEDESC command, after the node and its parent, that a Maya model's scaling rule
// reads (maya.c): the joint cancels the scale of its parent, and a child of the joint does so, which makes the joint
// keep its inverse scale for the children
#define NNS_G3D_SBC_NODEDESC_FLAG_MAYASSC_APPLY 0x01
#define NNS_G3D_SBC_NODEDESC_FLAG_MAYASSC_PARENT 0x02

#define NNS_G3D_SBCFLG_000 0x00
#define NNS_G3D_SBCFLG_001 0x20
#define NNS_G3D_SBCFLG_010 0x40
#define NNS_G3D_SBCFLG_011 0x60

// When a render object's callback runs for a command: before it (A), after its first part (B) or after all of it (C). A
// callback can set SKIP to leave out the part that follows it
#define NNS_G3D_SBC_CALLBACK_TIMING_A 1
#define NNS_G3D_SBC_CALLBACK_TIMING_B 2
#define NNS_G3D_SBC_CALLBACK_TIMING_C 3

// The flag of the render state. NODE_VISIBLE is whether the current node is shown, MAT_TRANSPARENT whether the current
// material is fully transparent, and the CURRENT_*_VALID flags whether the node, material and joint have been set.
// RETURN ends the stream, SKIP is set by a callback, and the OPT_* flags are the render object's options
#define NNS_G3D_RSFLAG_NODE_VISIBLE 0x00000001
#define NNS_G3D_RSFLAG_MAT_TRANSPARENT 0x00000002
#define NNS_G3D_RSFLAG_CURRENT_NODE_VALID 0x00000004
#define NNS_G3D_RSFLAG_CURRENT_MAT_VALID 0x00000008
#define NNS_G3D_RSFLAG_CURRENT_NODEDESC_VALID 0x00000010
#define NNS_G3D_RSFLAG_RETURN 0x00000020
#define NNS_G3D_RSFLAG_SKIP 0x00000040
#define NNS_G3D_RSFLAG_OPT_RECORD 0x00000080
#define NNS_G3D_RSFLAG_OPT_NOGECMD 0x00000100
#define NNS_G3D_RSFLAG_OPT_SKIP_SBCDRAW 0x00000200
#define NNS_G3D_RSFLAG_OPT_SKIP_SBCMTXCALC 0x00000400

// The most materials and joints that a model can have
#define NNS_G3D_SIZE_MAT_MAX 64
#define NNS_G3D_SIZE_JNT_MAX 64

// 0x188 bytes. isMatCached has a bit for each material whose result is made, isScaleCacheOne one for each joint whose
// scale is one, and isEvpCached one for each joint whose matrices for the envelope are made
struct NNSG3dRS {
    u8 *c;
    NNSG3dRenderObj *pRenderObj;
    u32 flag;
    NNSG3dSbcCallBackFunc cbVecFunc[NNS_G3D_SBC_COMMAND_NUM];
    u8 cbVecTiming[NNS_G3D_SBC_COMMAND_NUM];
    u8 currentNode;
    u8 currentMat;
    u8 currentNodeDesc;
    u8 dummy_;
    NNSG3dMatAnmResult *pMatAnmResult;
    NNSG3dJntAnmResult *pJntAnmResult;
    NNSG3dVisAnmResult *pVisAnmResult;
    u32 isMatCached[NNS_G3D_SIZE_MAT_MAX / 32];
    u32 isScaleCacheOne[NNS_G3D_SIZE_JNT_MAX / 32];
    u32 isEvpCached[NNS_G3D_SIZE_JNT_MAX / 32];
    const NNSG3dResNodeInfo *pResNodeInfo;
    const NNSG3dResMat *pResMat;
    const NNSG3dResShp *pResShp;
    fx32 posScale;
    fx32 invPosScale;
    NNSG3dGetJointScale funcJntScale;
    NNSG3dSendJointSRT funcJntMtx;
    NNSG3dSendTexSRT funcTexMtx;
    NNSG3dMatAnmResult tmpMatAnmResult;
    NNSG3dJntAnmResult tmpJntAnmResult;
    NNSG3dVisAnmResult tmpVisAnmResult;
};

// A command's function, and the functions that draw a material or a shape of the item tag in its data: its render
// state, option, data and index
typedef void (*NNSG3dFuncSbc)(NNSG3dRS *rs, u32 opt);
typedef void (*NNSG3dFuncSbc_MatInternal)(NNSG3dRS *rs, u32 opt, const NNSG3dResMatData *mat, u32 matID);
typedef void (*NNSG3dFuncSbc_ShpInternal)(NNSG3dRS *rs, u32 opt, const NNSG3dResShpData *shp, u32 shpID);

extern NNSG3dFuncSbc NNS_G3dFuncSbcTable[NNS_G3D_SBC_COMMAND_NUM]; // swan's NNS_G3D_RENDER_FUNC
extern NNSG3dFuncSbc_MatInternal NNS_G3dFuncSbcMatTable[4];        // swan's NNS_G3D_MATERIAL_APPLY_FUNCS
extern NNSG3dFuncSbc_ShpInternal NNS_G3dFuncSbcShpTable[4];

// The state of the model being drawn, while there is one: a draw within a callback shares it
extern NNSG3dRS *NNS_G3dRS; // swan's g_NNSG3DModelRenderer

// The matrices that NNSi_G3dFuncSbc_NODEMIX makes for a joint of the envelope: the clip matrix and the normal
// matrix, 100 bytes together
typedef struct {
    MtxFx44 clip;
    MtxFx33 normal;
} IbpMatrix;

// What the model being drawn keeps for its nodes outside the render state, in one object: the result of each
// material, which a node reuses once one has made it; the scale and inverse scale of each joint relative to the root,
// which the scaling rules set and read for the joints below it; and the matrices that NODEMIX makes for each joint of
// the envelope
typedef struct {
    NNSG3dMatAnmResult matCache[NNS_G3D_SIZE_MAT_MAX];
    NNSG3dJointScale scaleCache[NNS_G3D_SIZE_JNT_MAX];
    IbpMatrix evpCache[NNS_G3D_SIZE_JNT_MAX];
} NNSG3dRSOnGlb;

extern NNSG3dRSOnGlb NNS_G3dRSOnGlb; // swan's g_NNSMaterials

// The commands. Swan: NNS_G3DRenderFuncNop, Return, SetVisGroup, LoadMatrix, ApplyMaterialDefault, ApplyMaterial,
// DrawMeshDefault, DrawMesh, ApplyJointMatrix, SetBillboardMatrix1, SetBillboardMatrix2, ApplySmoSkMatrix,
// ExecFIFOQueue, GlobalScale, ApplySphereMap and ApplyProjectionMap
void NNSi_G3dFuncSbc_NOP(NNSG3dRS *rs, u32 opt);
void NNSi_G3dFuncSbc_RET(NNSG3dRS *rs, u32 opt);
void NNSi_G3dFuncSbc_NODE(NNSG3dRS *rs, u32 opt);
void NNSi_G3dFuncSbc_MTX(NNSG3dRS *rs, u32 opt);
void NNSi_G3dFuncSbc_MAT_InternalDefault(NNSG3dRS *rs, u32 opt, const NNSG3dResMatData *mat, u32 matID);
void NNSi_G3dFuncSbc_MAT(NNSG3dRS *rs, u32 opt);
void NNSi_G3dFuncSbc_SHP_InternalDefault(NNSG3dRS *rs, u32 opt, const NNSG3dResShpData *shp, u32 shpID);
void NNSi_G3dFuncSbc_SHP(NNSG3dRS *rs, u32 opt);
void NNSi_G3dFuncSbc_NODEDESC(NNSG3dRS *rs, u32 opt);
void NNSi_G3dFuncSbc_BB(NNSG3dRS *rs, u32 opt);
void NNSi_G3dFuncSbc_BBY(NNSG3dRS *rs, u32 opt);
void NNSi_G3dFuncSbc_NODEMIX(NNSG3dRS *rs, u32 opt);
void NNSi_G3dFuncSbc_CALLDL(NNSG3dRS *rs, u32 opt);
void NNSi_G3dFuncSbc_POSSCALE(NNSG3dRS *rs, u32 opt);
void NNSi_G3dFuncSbc_ENVMAP(NNSG3dRS *rs, u32 opt);
void NNSi_G3dFuncSbc_PRJMAP(NNSG3dRS *rs, u32 opt);

// Set the lights, polygon mode, culling, polygon ID and alpha of a material of a model resource, in the bits of its
// polygon attribute (model.c). The lights are the mask of the four that shine on it, and the alpha is from 0 to 31.
// swan's names are NNS_G3DResMdlSetMatLights, ShadingMode, FaceCulling, PolyID and Alpha
void NNS_G3dMdlSetMdlLightEnableFlag(NNSG3dResMdl *mdl, u32 matID, int lights);
void NNS_G3dMdlSetMdlPolygonMode(NNSG3dResMdl *mdl, u32 matID, GXPolygonMode mode);
void NNS_G3dMdlSetMdlCullMode(NNSG3dResMdl *mdl, u32 matID, GXCull cull);
void NNS_G3dMdlSetMdlPolygonID(NNSG3dResMdl *mdl, u32 matID, int polyID);
void NNS_G3dMdlSetMdlAlpha(NNSG3dResMdl *mdl, u32 matID, int alpha);
int NNS_G3dMdlGetMdlAlpha(const NNSG3dResMdl *mdl, u32 matID);
// Turns fog on or off for a material of a model resource, or for every material
void NNS_G3dMdlSetMdlFogEnableFlag(NNSG3dResMdl *mdl, u32 matID, BOOL enable);
// Set the polygon ID or the alpha of every material of a model resource
void NNS_G3dMdlSetMdlPolygonIDAll(NNSG3dResMdl *mdl, int polyID);
void NNS_G3dMdlSetMdlAlphaAll(NNSG3dResMdl *mdl, int alpha);
void NNS_G3dMdlSetMdlFogEnableFlagAll(NNSG3dResMdl *mdl, BOOL enable);

// Where a point of the world is on the screen, and 0 if it is within the viewport, or -1 (util.c; swan's
// NNS_G3DProject)
int NNS_G3dWorldPosToScrPos(const VecFx32 *world, int *x, int *y);
// The near and far ends of the line in the world that a screen position is on (the far end is left out for a null
// pointer), and 0 if the position is within the viewport, or -1
int NNS_G3dScrPosToWorldLine(int px, int py, VecFx32 *nearPos, VecFx32 *farPos);

#endif // POKEBW2_NNSYS_G3D_H

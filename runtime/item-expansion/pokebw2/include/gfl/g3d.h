#ifndef POKEBW2_GFL_G3D_H
#define POKEBW2_GFL_G3D_H

// Names, layouts and constants from swan (https://github.com/ds-pokemon-hacking/swan, GPL-3.0), except the scene
// setup, whose layout comes from the intro's data

#include "types.h"
#include "gfl/heap.h"
#include "gfl/std.h"
#include "nitro/fx.h"
#include "nitro/gx.h"
#include "nitro/mi.h"
#include "nnsys/g3d.h"
#include "struct_decls.h"

typedef struct G3DActor G3DActor;
typedef struct G3DCamera G3DCamera;
typedef struct G3DCurve G3DCurve;
typedef struct G3DLight G3DLight;
typedef struct G3DManager G3DManager;
typedef struct G3DModel G3DModel;

// Curves (ica_anime.c) that keep their keyframes in the caller's buffer: preloadCount frames at a time, or all of them.
// They return NULL when the buffer is too small. GFL_G3DCurveCreateToLoadBufferEntire is not from swan
G3DCurve *GFL_G3DCurveCreateToLoadBufferEntire(HeapID heapId, u32 arcId, u16 fileId, void *buffer, u32 bufferSize);
G3DCurve *GFL_G3DCurveCreateToLoadBuffer(HeapID heapId, u32 arcId, u32 fileId, u32 preloadCount, void *buffer,
                                         u32 bufferSize);
void GFL_G3DResBindData(void *resource, u32 kind, void *data);
BOOL GFL_G3DCurveFrameStepLoop(G3DCurve *curve, fx32 step);
BOOL GFL_G3DCurveGetNowTranslation(G3DCurve *curve, VecFx32 *translation);
BOOL GFL_G3DCurveGetNowRotation(G3DCurve *curve, VecFx32 *rotation);

typedef enum {
    G3DCAM_PROJECTION_PERSPECTIVE,
    G3DCAM_PROJECTION_FRUSTUM,
    G3DCAM_PROJECTION_ORTHO,
} G3DCameraProjectionMode;

// A projection: for a perspective one, the sine and cosine of half its field of view, its aspect ratio and an unused
// value, or for the others, the top, bottom, left and right of the view
typedef struct {
    G3DCameraProjectionMode type;
    fx32 param1;
    fx32 param2;
    fx32 param3;
    fx32 param4;
    fx32 near;
    fx32 far;
    fx32 ndcRangeOverride;
} G3DCameraProjection;

typedef struct {
    VecFx32 position;
    VecFx32 upVector;
    VecFx32 target;
} FxLookAt;

typedef struct {
    VecFx32 translation;
    VecFx32 scale;
    MtxFx33 rotation;
} SRTMatrix;

typedef void (*G3DSystemInitCallback)(void);

typedef struct {
    VecFx16 direction;
    GXRgb color;
} Light;

typedef struct {
    u8 index;
    Light light;
} LightSetup;

typedef struct {
    const LightSetup *lights;
    u8 count;
} LightSetupList;

// What GFL_G3DResCheckType checks a resource for: nothing, a model, textures or an animation
enum {
    G3D_RES_CHECK_NONE,
    G3D_RES_CHECK_MDL,
    G3D_RES_CHECK_TEX,
    G3D_RES_CHECK_ANM,
};

// How a scene's resource is read: from an archive or a file by path, into the 3D system's heap or the manager's
enum {
    G3D_SCENE_RES_ARCSYS,
    G3D_SCENE_RES_FS,
    G3D_SCENE_RES_ARCSYS_MGRHEAP,
    G3D_SCENE_RES_FS_MGRHEAP,
};

// A scene that GFL_G3DMgrNewScene loads: its resources, and its actors, each a model with animations
typedef struct {
    // The archive, or for the G3D_SCENE_RES_FS types its path
    u32 arcId;
    u16 fileId;
    u16 unk6;
    u32 type;
} G3DSceneResourceSetup;

typedef struct {
    u16 resource;
    u16 index;
} G3DSceneAnimationSetup;

// An actor's resources, as indices into the scene's. An animation whose resource is 0xff is left out
typedef struct {
    u16 modelResource;
    u16 modelIndex;
    u16 texResource;
    u16 unk6;
    const G3DSceneAnimationSetup *animations;
    u16 animationCount;
} G3DSceneActorSetup;

typedef struct {
    const G3DSceneResourceSetup *resources;
    u16 resourceCount;
    const G3DSceneActorSetup *actors;
    u16 actorCount;
} G3DSceneSetup;

// Sets up the 3D system with frame or linked-list VRAM managers, the VRAM they manage in 128 KB slots of texture VRAM
// and 16 KB ones of palette VRAM, and how much DTCM the geometry command buffer takes. With no callback it sets up the
// 3D display itself
void GFL_G3DSysCreate(BOOL frmTexVramMgr, u32 texVramSize, BOOL frmPltVramMgr, u32 pltVramSize, u16 dtcmAllocSize,
                      HeapID heapId, G3DSystemInitCallback initCallback);
void GFL_G3DSysFree(void);
void GFL_G3DSysLightSet(u8 lightId, const Light *light);
void GFL_G3DSysMtxGetProjection(G3DCameraProjection *dest);
void GFL_G3DSysMtxSetProjection(const G3DCameraProjection *projection);
void GFL_G3DSysMtxGetViewLookAt(FxLookAt *dest);
void GFL_G3DSysMtxSetViewLookAt(const FxLookAt *lookAt);
void GFL_G3DSysMtxViewFlush(void);
void GFL_G3DSysReqSwapBuffers(void);
// Swaps the buffers if they were requested, at the vertical blank
void GFL_G3DSysCheckSwapBuffers(void);
void GFL_G3DSysReset(void);
void GFL_G3DSysSetSwapBufferParams(u32 sortMode, u32 bufferMode);
// Whether the texture and palette VRAM managers are frame ones
BOOL GFL_G3DSysUsesFrmTexVramMgr(void);
BOOL GFL_G3DSysUsesFrmPlttVramMgr(void);
// Resources, each a file of a model, textures or an animation
void *GFL_G3DSysReadArcSysResource(u32 arcId, u32 fileId);
void *GFL_G3DSysReadArcToolResource(ArcTool *handle, u32 fileId);
void *GFL_G3DSysReadFSResource(const char *path, u32 fileId);
// The size of a resource, for one allocated outside the 3D system, which GFL_G3DResSetup sets up with its file
u32 GFL_G3DResGetAllocSize(void);
void GFL_G3DResSetup(void *resource, void *data);
BOOL GFL_G3DResCheckType(void *resource, u32 type);
BOOL GFL_G3DResIsTexUploadDone(void *resource);
// Puts a resource's textures and palettes in VRAM, and frees them; SetupTexData only allocates the VRAM, and
// UploadAndRelease also frees the texture images once they are in VRAM
BOOL GFL_G3DResUploadTexData(void *resource);
BOOL GFL_G3DResUploadAndReleaseTexData(void *resource);
BOOL GFL_G3DResSetupTexData(void *resource);
BOOL GFL_G3DResUploadTexDataCore(void *resource);
BOOL GFL_G3DResFreeTexData(void *resource);
NNSG3dResTex *GFL_G3DResGetTexData(void *resource);
NNSGfdTexKey GFL_G3DResGetTexVRAMHandle(void *resource);
NNSGfdPlttKey GFL_G3DResGetPltVRAMHandle(void *resource);
void *GFL_G3DResGetTexImageData(void *resource);
void *GFL_G3DResGetTexPaletteData(void *resource);
void *GFL_G3DResGetResData(void *resource);
void GFL_G3DResFree(void *resource);
// The size of a resource's header, which GFL_G3DResSetup fills in
u32 GFL_G3DResGetAllocSize(void);
void GFL_G3DResSetup(void *resource, void *data);
void *GFL_G3DSysReadArcSysResource(u32 arcId, u32 fileId);
BOOL GFL_G3DResUploadAndReleaseTexData(void *resource);
G3DModel *GFL_G3DMdlCreate(void *resource, u32 modelId, void *texture);
void GFL_G3DMdlFree(G3DModel *model);
void *GFL_G3DMdlGetMdlResource(G3DModel *model);
void *GFL_G3DMdlGetTexResource(G3DModel *model);
void *GFL_G3DAnmCreate(G3DModel *model, void *resource, u32 a2);
void GFL_G3DAnmFree(void *animation);
NNSG3dAnmObj *GFL_G3DAnmGetRenderObj(void *animation);
G3DActor *GFL_G3DActorCreate(G3DModel *model, void **animations, int count);
void GFL_G3DActorFree(G3DActor *actor);

G3DLight *GFL_G3DLightCreate(const LightSetupList *setup, HeapID heapId);
void GFL_G3DLightFree(G3DLight *lights);
void GFL_G3DLightFlush(G3DLight *lights);
void GFL_G3DLightGetDirVector(G3DLight *lights, u8 lightId, VecFx16 *direction);
void GFL_G3DLightSetDirVector(G3DLight *lights, u8 lightId, const VecFx16 *direction);
void GFL_G3DLightGetColor(G3DLight *lights, u8 lightId, GXRgb *color);
void GFL_G3DLightSetColor(G3DLight *lights, u8 lightId, const GXRgb *color);

G3DCamera *GFL_G3DCameraCreate(G3DCameraProjectionMode proj, fx32 param1, fx32 param2, fx32 param3, fx32 param4,
                               fx32 near, fx32 far, fx32 ndcRangeOverride, const VecFx32 *position,
                               const VecFx32 *upVector, const VecFx32 *target, HeapID heapId);
void GFL_G3DCameraFree(G3DCamera *cam);
void GFL_G3DCameraFlush(G3DCamera *cam);
void GFL_G3DCameraSetProjectionZNear(G3DCamera *cam, fx32 *zNear);
void GFL_G3DCameraSetProjectionZFar(G3DCamera *cam, fx32 *zFar);
void GFL_G3DCameraGetProjectionZNear(G3DCamera *cam, fx32 *zNear);
G3DCameraProjectionMode GFL_G3DCameraGetProjectionType(G3DCamera *cam);
void GFL_G3DCameraGetLookatPos(G3DCamera *cam, VecFx32 *pos);
void GFL_G3DCameraSetLookatPos(G3DCamera *cam, const VecFx32 *pos);
void GFL_G3DCameraGetLookatUpVector(G3DCamera *cam, VecFx32 *up);
void GFL_G3DCameraSetLookatUpVector(G3DCamera *cam, const VecFx32 *up);
void GFL_G3DCameraGetLookatTarget(G3DCamera *cam, VecFx32 *target);
void GFL_G3DCameraSetLookatTarget(G3DCamera *cam, const VecFx32 *target);
// The projection's parameters as a perspective one's field of view, or an orthographic one's top and bottom
void GFL_G3DCameraPerspectiveSetFOVSin(G3DCamera *cam, fx32 fovSin);
void GFL_G3DCameraPerspectiveGetFOVCos(G3DCamera *cam, fx32 *fovCos);
void GFL_G3DCameraPerspectiveSetFOVCos(G3DCamera *cam, fx32 fovCos);
void GFL_G3DCameraOrthoGetTop(G3DCamera *cam, fx32 *top);
void GFL_G3DCameraOrthoSetTop(G3DCamera *cam, fx32 top);
void GFL_G3DCameraOrthoGetBottom(G3DCamera *cam, fx32 *bottom);
void GFL_G3DCameraOrthoSetBottom(G3DCamera *cam, fx32 bottom);

BOOL GFL_G3DActorUnbindAnm(G3DActor *actor, u16 anmIdx);
BOOL GFL_G3DActorResetAnmFrame(G3DActor *actor, u16 anmIdx);
BOOL GFL_G3DActorGetAnmFrame(G3DActor *actor, u16 anmIdx, fx32 *frame);
BOOL GFL_G3DActorSetAnmFrame(G3DActor *actor, u16 anmIdx, fx32 *frame);
BOOL GFL_G3DActorGetAnmFrameCount(G3DActor *actor, u16 anmIdx, fx32 *count);
// Returns FALSE once the animation has reached its end
BOOL GFL_G3DActorStepAnmFrame(G3DActor *actor, u16 anmIdx, fx32 addend);
// The same, going back to the start at the end
BOOL GFL_G3DActorStepAnmFrameLoop(G3DActor *actor, u16 anmIdx, fx32 addend);
void GFL_G3DSysDrawObj(G3DActor *obj, const SRTMatrix *mdlMtx);
// Draws the actor if its bounding box is in view, returning whether it was
BOOL GFL_G3DSysDrawObjBBoxCull(G3DActor *obj, SRTMatrix *mdlMtx);
void GFL_G3DSysDispatchDraw(NNSG3dRenderObj *renderObj);
// The polygons and vertices drawn since the counts were reset
void GFL_G3DSysResetGeometryCounter(void);
G3DModel *GFL_G3DActorGetMdl(G3DActor *actor);
u16 GFL_G3DActorGetAnmCount(G3DActor *actor);
BOOL GFL_G3DActorBindAnm(G3DActor *actor, u16 anmIdx);
void *GFL_G3DActorGetAnm(G3DActor *actor, u16 index);
NNSG3dRenderObj *GFL_G3DMdlGetEngineModel(G3DModel *model);
void *GFL_G3DMdlGetTexResource(G3DModel *model);

G3DManager *GFL_G3DMgrCreate(u16 resourceLimit, u16 actorLimit, HeapID heapId);
void GFL_G3DMgrFree(G3DManager *manager);
u16 GFL_G3DMgrNewScene(G3DManager *manager, const G3DSceneSetup *setup);
// The same, with every resource read already, or read from an archive that is open
u16 GFL_G3DMgrNewSceneFast(G3DManager *manager, const G3DSceneSetup *setup);
u16 GFL_G3DMgrNewSceneFastEx(G3DManager *manager, const G3DSceneSetup *setup, ArcTool *arc);
void GFL_G3DMgrDeleteScene(G3DManager *manager, u16 scene);
u16 GFL_G3DMgrGetSceneResCount(G3DManager *manager, u16 scene);
u16 GFL_G3DSceneGetNodeActorCount(G3DManager *manager, u16 scene);
void *GFL_G3DMgrGetResource(G3DManager *manager, u16 resource);
// The index of an actor, which GFL_G3DMgrGetActor takes. A scene's actors have consecutive indices
G3DActor *GFL_G3DMgrGetActor(G3DManager *manager, u16 actor);
u16 GFL_G3DMgrGetSceneFirstActorIdx(G3DManager *manager, u16 scene);

// Curves, which move a camera along a path loaded from a file, a frame at a time
G3DCurve *GFL_G3DCurveLoadFileAll(HeapID heapId, u32 arcId, u32 fileId);
// Loads a curve whose keyframes are read from the file as they are needed, preloadCount at a time
G3DCurve *GFL_G3DCurveLoadFileStream(HeapID heapId, u32 arcId, u32 fileId, u32 preloadCount);
void GFL_G3DCurveFree(G3DCurve *curve);
// Returns TRUE once the curve has reached its last frame, where it stays
BOOL GFL_G3DCurveFrameStep(G3DCurve *curve, fx32 step);
void GFL_G3DCurveFrameSet(G3DCurve *curve, fx32 frame);
fx32 GFL_G3DCurveGetNowFrame(G3DCurve *curve);
u32 GFL_G3DCurveGetFrameCount(G3DCurve *curve);
// The curve's values at a frame. They return FALSE when they give no value
BOOL GFL_G3DCurveGetNowTranslationLoop(const G3DCurve *curve, VecFx32 *translation, u32 frame);
BOOL GFL_G3DCurveGetNowRotationLoop(const G3DCurve *curve, VecFx32 *rotation, u32 frame);
BOOL GFL_G3DCurveGetNowScaleLoop(const G3DCurve *curve, VecFx32 *scale, u32 frame);
void GFL_G3DCurveApplyCamera(G3DCamera *camera, G3DCurve *curve);
// Moves the camera, or its target, to the curve's translation at its frame
void GFL_G3DCurveApplyCameraPosTranslation(G3DCamera *camera, G3DCurve *curve);
void GFL_G3DCurveApplyCameraTgtTranslation(G3DCamera *camera, G3DCurve *curve);
void GFL_G3DSysResetGeometryCounter(void);

#endif // POKEBW2_GFL_G3D_H

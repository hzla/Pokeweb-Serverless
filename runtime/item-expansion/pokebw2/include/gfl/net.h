#ifndef POKEBW2_GFL_NET_H
#define POKEBW2_GFL_NET_H

#include "types.h"
#include "gfl/heap.h"
#include "gfl/net_handle.h"
#include "struct_decls.h"

// The unnamed functions below are from the network library. Some appear to synchronize with the other player or
// toggle error checks, but that is not confirmed.

// How the game set up the network: what net.c keeps from GFL_NetInit
typedef struct {
    // The game's commands, a NetCommand table
    const void *commandTable;
    int commandNum;
    // Called when a machine disconnects
    void (*disconnectCallback)(void *work, int netId);
    // Called when a machine's negotiation is accepted
    void (*negotiationCallback)(void *work, int netId);
    // The data this machine shares with the others, and its size
    void *(*getInfo)(void *work);
    int (*getInfoSize)(void *work);
    // The data the wireless beacons carry, and its size
    void *(*getBeaconData)(void *work);
    int (*getBeaconSize)(void *work);
    // Whether a beacon's game is one to join, a BOOL (*)(u8 gameCommandBase, u8 beaconCommandBase, void *work) that the
    // games give with fewer parameters
    void *unk20;
    // Called with the wireless library's error when it fails
    void (*errorCallback)(NetHandle *handle, int a1, void *work);
    void (*unk28)(NetHandle *handle, int a1, void *work);
    // Called once the network has ended, and when a child connects to the changeover's parent
    void (*endCallback)(void *work);
    void (*childConnectCallback)(void *work);
    // 12 bytes that the games' init data zero, the last four of which are a function that dwc_rap.c calls with each
    // Wi-Fi library error it queues (its code and its second value), and the game's work
    union {
        u8 unk34[0xc];
        struct {
            u8 unk34_0[8];
            void (*callback)(int code, int param, void *work);
        } wifiError;
    } unk34;
    // The Wi-Fi friend list (DWCFriendData) and user data (DWCUserData)
    int (*getFriendData)(void *work);
    int (*getUserData)(void *work);
    // The size of the heap for Wi-Fi
    u32 wifiHeapSize;
    // The game's ID in the wireless beacons (gameId, of which the low 16 bits go in them) after four more bytes. The
    // games' init data give the bytes
    union {
        u8 unk4C[8];
        struct {
            u32 unk4C_0;
            u32 gameId;
        } id;
    } unk4C;
    HeapID parentHeapId;
    HeapID heapId;
    HeapID wifiHeapId;
    HeapID ircHeapId;
    // Where the wireless signal icon is
    u16 iconX;
    u16 iconY;
    u8 maxConnectNum;
    // The largest packet
    u8 maxSendSize;
    u8 unk62;
    u8 unk63;
    // Whether the parent relays every machine's data (MP mode)
    u8 bMPMode;
    // A GFL_NET_TYPE_*
    u8 bNetType;
    // Whether starting a parent takes a new TGID
    u8 changeTgid;
    // The high byte of the game's commands
    u8 gameCommandBase;
    // Four bytes that the games give, which overlay 175 sets as one word
    union {
        u8 bytes[4];
        u32 word;
    } unk68;
    // The parent's packet size in MP mode, 0 for the default
    u16 parentPacketSize;
    // A command base that machines of different gameCommandBase negotiate with, 0 for none
    u16 negotiationCommandBase;
} GFLNetInitData;

// The most machines that can connect
#define GFL_NET_MACHINE_MAX 8

// The kinds of connection: Wi-Fi through DWC, and the others through the wireless or infrared devices
#define GFL_NET_TYPE_WIFI 1
#define GFL_NET_TYPE_WIFI_LOBBY 2
#define GFL_NET_TYPE_WIFI_GTS 6

// What the network device does, wireless or Wi-Fi; the code calls each through GFLNetSys
typedef BOOL (*GFLNetRecvFunc)(u16 netId, u8 *data, u16 size);
typedef BOOL (*GFLNetSendDoneFunc)(BOOL ok);

typedef struct {
    // Prepares the device before its heap is made (the Wi-Fi library's start)
    void (*prepare)(int a0, int a1);
    // Starts the device; the callback, which the wireless device calls when its helper ends, is NULL from the net
    BOOL (*init)(HeapID heapId, void *sys, BOOL (*callback)(BOOL success), void *work);
    BOOL (*start)(void (*callback)(BOOL ok));
    // Runs the device each frame with the connected machines, returning a negative error or a status
    int (*update)(u16 connectBits);
    BOOL (*disconnect)(int a0, int a1);
    BOOL (*end)(void (*callback)(BOOL ok));
    BOOL (*unk18)(void);
    BOOL (*unk1C)(void);
    BOOL (*unk20)(void);
    BOOL (*unk24)(void);
    // A found beacon's data and MAC address, by index
    void *(*getBeaconData)(int index);
    u8 *(*getBeaconMac)(int index);
    BOOL (*unk30)(void);
    BOOL (*unk34)(void);
    // Whether beacons were found
    BOOL (*hasBeacons)(int a0);
    BOOL (*setDisconnectCallback)(void (*callback)(int netId));
    // Start the wireless parent, the scan for parents and the child of a parent
    int (*startParent)(int a0, BOOL (*callback)(void));
    BOOL (*startScan)(int a0, int a1);
    int (*startChild)(BOOL a0, const u8 *mac, int a2, int a3, void (*callback)(void));
    // Start a Wi-Fi match, and connect to a Wi-Fi friend by index (anybody when negative)
    BOOL (*startMatch)(int a0, int a1, int a2, int a3);
    BOOL (*connectFriend)(int a0, int a1, int a2);
    // Closes the connection, FALSE until it is closed
    BOOL (*close)(BOOL a0, int a1);
    // Whether the wireless device shares data, and its step of the data sharing
    BOOL (*isDataSharing)(void);
    BOOL (*stepDataSharing)(u8 *data);
    u8 *(*getRecvData)(int netId);
    BOOL (*send)(u8 *data, int size, int a2, GFLNetSendDoneFunc callback);
    BOOL (*setRecvCallback)(GFLNetRecvFunc callback);
    BOOL (*isRunning)(void);
    BOOL (*isConnected)(void);
    // Whether the device has ended, and whether it is idle, ready to start again
    BOOL (*isEnded)(void);
    BOOL (*isIdle)(void);
    int (*getConnectBits)(void);
    int (*getNetId)(void);
    int (*getSignalLevel)(void);
    int (*isError)(void);
    // Whether a machine leaving is an error
    void (*setDisconnectError)(int a0);
    // Whether the Wi-Fi friend of an index can be connected to
    int (*canConnectFriend)(int a0);
    int (*unk94)(void);
    int (*unk98)(void);
    // The infrared device's work each frame, whether it can send, whether it is its turn, whether the other machine
    // was seen, and whether the two are linked
    void (*poll)(void);
    BOOL (*canSend)(void);
    BOOL (*isSendTurn)(void);
    BOOL (*isPeerSeen)(void);
    BOOL (*isLinked)(void);
    BOOL (*unkB0)(void);
    void (*startLink)(void);
    // Whether connections are accepted
    void (*setAcceptConnect)(int a0);
    // Start the search for beacons, and hold the scan for some frames
    BOOL (*startSearch)(void);
    void (*holdScan)(int a0);
    // The infrared device's timeout, and its filter of the machines to link with
    void (*setTimeout)(int a0);
    void (*setPeerFilter)(void *a0);
} GFLNetDevTable;

// The network library's state, with a copy of the game's init data
typedef struct {
    GFLNetInitData aNetInit;
    NetHandle handles[GFL_NET_HANDLE_MAX];
    const GFLNetDevTable *pDevTable;
    u8 unk344[4];
    // Called when the network has ended
    void (*exitCallback)(void *work);
    void *devWork;
    u8 unk350[2];
    // Whether a handle already negotiated may still be rejected
    u8 rejectNegotiated;
    u8 unk353;
} GFLNetSys;

// The network error, which NetState_RecordError records
typedef struct {
    int code;
    // The error's type and the error (DWC_GetLastErrorEx's for Wi-Fi)
    u32 errorType;
    u32 error;
    // Nonzero once an error is recorded, the line it was found on for net_system.c's
    int type;
} GFLNetErrorInfo;

void NetCommand_UpdateHugeSend(void);
// Command handlers of the other parts of the library
void NetCommand_Dispatch(int netId, int sender, int command, int size, void *data, NetHandle *handle);
BOOL NetCommand_HasCallback(int command);
BOOL NetCommand_HasBufferFunc(int command);
void *NetCommand_GetRecvBuffer(int command, int netId, int size);
BOOL NetCommand_IsForThisMachine(int netId);

// net_err.c: the network error screen. The error's code is its message in TEXT_BANK_WIFI_ERROR
// Creates the network's heap, and the buffers the error screen saves the display in
void GFL_NetHeapInit(void);
void GFL_NetErrInit(u32 heapId);
// Finds the network's error, each frame
void GFL_NetErrUpdate(void);
// What the game is to do about the network's error, if there is one: 1 to go on, 2 to end the connection
BOOL GFL_NetErrCheck(void);
void GFL_NetErrMarkShown(void);
BOOL GFL_NetErrShow(u32 a0);
// Shows the fatal error screen for a Wi-Fi error with the message given
void GFL_NetErrShowWifi(u32 message);
// GFL_NetErrShow(1)
void GFL_NetErrShowFatal(void);
// Records a Wi-Fi error with the message given, to show it
void GFL_NetErrRecordWifi(u32 message);
// The message for a server's result
u32 GFL_NetErrGetServerMessage(int result);
// Whether GFL_NetErrShowScreen leaves the screens dark, for the caller to set the brightness with
// GFL_NetErrApplyBrightness
void GFL_NetErrSetKeepDark(BOOL keepDark);
void GFL_NetErrClearKeepDark(void);
void GFL_NetErrApplyBrightness(void);
// Shows the error screen until A or B is pressed, with the wireless icon
void GFL_NetErrShowScreen(void);
// Whether the error was handled, after shutting the connection down
BOOL GFL_NetErrShutdown(void);
void GFL_NetErrClear(void);
// The state of the wireless connections, as bits: 0x2 a local wireless one, 0x3c the signal, 0x3c0 Wi-Fi
u32 WihDwc_GetStatus(WifiList *wifiList);
void *WihDwc_Create(int num, HeapID heapId);
void WihDwc_Destroy(void *work);
void WihDwc_TickTimers(void);
void GFL_NetErrAbort(void);
void GFL_NetErrRecord(void);
// Shows the error screen for an assertion that failed
void AssertFailErrorDisp(void);
// The wireless signal level of the DS Download Play, and the record of the best level a scan saw, which it sets and
// clears
u16 WihDwc_GetLinkLevel(void);
void WihDwc_SetBestLinkLevel(u8 linkLevel);
void WihDwc_OnParentNotFound(void);

// The device table for a GFL_NET_TYPE_*, from outside the library
const GFLNetDevTable *NetDefine_LoadDevice(int type);
void NetDefine_UnloadDevice(int type);
// GFL_SndBGMSetVolume, unless a connection is up and overlay 11's DWCRap_IsVoiceChatEnabled returns TRUE
void NetBgmVolume_Set(u16 trackMask, s32 volume);

// net.c: starts and ends the network, and passes calls to the device and the other parts of the library
void GFL_NetBoot(int a0, int a1, HeapID parentHeapId, HeapID heapId);
void GFL_NetInit(const GFLNetInitData *pNetInit, void (*callback)(void *work), void *work);
BOOL GFL_NetIsInitialized(void);
// Whether the network has ended
BOOL GFL_NetIsEnded(void);
// Ends the network, calling back with the game's work once it has
BOOL GFL_NetExit(void (*callback)(void *work));
void GFL_NetCancelEnd(void);
void *GFL_NetGetBeaconData(int index);
u8 *GFL_NetGetBeaconMac(int index);
// Steps the network while the game waits for it, as before a soft reset
BOOL GFL_NetMainWhileWaiting(void);
void GFL_NetUpdateDevice(void);
void GFL_NetStartAsParent(const u8 *mac);
void GFL_NetStartAsChild(const u8 *mac);
void GFL_NetStartScan(void);
void GFL_NetStartServer(void);
void GFL_NetIwChangeoverConnect(void (*callback)(void *work), void (*a1)(void *work, BOOL a1), void (*a2)(void *work));
void GFL_NetIwSetGameCommandBase(int a0);
void GFL_NetIwGetCollectedMac(u8 *mac, int index);
void GFL_NetIwSetPeerFilter(void *a0);
void GFL_NetIwFree(void);
void GFL_NetChangeoverConnect(void (*callback)(void *work));
// The argument is unused
void GFL_NetStartSearch(int unused);
void GFL_NetHoldScan(int a0);
void GFL_NetSetChangeoverMode(int mode, int a1, const u8 *mac);
BOOL GFL_NetIwFinishCollecting(void);
void GFL_NetIwOverrideNetId(int a0);
u8 GFL_NetIwGetLinkedCount(void);
void GFL_NetSetTimeout(int a0);
u8 GFL_NetGetHandleNetId(NetHandle *handle);
int GFL_NetGetNegotiatedCount(void);
BOOL GFL_NetIsNegotiated(u8 netId);
void GFL_NetSetAcceptConnect(NetHandle *handle, int a1);
BOOL GFL_NetIsNotInitialized(void);
// Whether the network is infrared, or Wi-Fi
BOOL GFL_NetIsInfrared(void);
BOOL GFL_NetIsWifi(void);
// Calls into the functions that show the wireless strength icons
void GFL_NetSetIconScreen(BOOL top, HeapID heapId);
BOOL GFL_NetIsParent(void);
// Whether a machine's negotiation has been accepted
BOOL GFL_NetIsHandleNegotiated(NetHandle *handle);
// Send a command to every machine, or to one; the game's commands wait for the negotiation
BOOL GFL_NetSendCommand(NetHandle *handle, int command, u16 size, const void *data);
BOOL GFL_NetSendCommandToMachine(NetHandle *handle, u8 sendID, u16 command, u32 size, const void *data, u32 a5, BOOL a6,
                                 BOOL noCopy);
BOOL GFL_NetSendCommandToBits(NetHandle *handle, int dest, u16 command, int size, const void *data, u32 a5, BOOL a6,
                              BOOL noCopy);
BOOL GFL_NetIsSendQueueEmpty(NetHandle *handle);
void GFL_NetSendTiming(NetHandle *handle, u16 timing);
BOOL GFL_NetIsTimingRecv(NetHandle *handle, u16 timing);
// The second argument is unused
void GFL_NetSetGameCommandBase(u8 gameCommandBase, u8 unused);
u8 GFL_NetGetGameCommandBase(void);
// Whether the net game command base is one of the battle kinds
BOOL func_02011844(void);
int GFL_NetGetUserData(void);
int GFL_NetGetFriendData(void);
u8 func_02042d80(void);
void GFL_NetSetMPSendEnabled(BOOL a0);
// The game's work, which the callbacks get
void *GFL_NetGetWork(void);
void GFL_NetSetWork(void *work);
// The number of machines, and the size of each machine's data in a packet
int GFL_NetGetMaxConnectNum(void);
int GFL_NetGetMaxSendSize(void);
u16 GFL_NetGetParentPacketSize(void);
void GFL_NetNotifyChildConnect(void);
void func_02042e30(int a0);
void GFL_NetNotifyError(int a0);
GFLNetSys *GFL_NetGetSys(void);
GFLNetInitData *GFL_NetGetInitData(void);
void func_02042e94(u8 a0);
void GFL_NetSetDisconnectError(BOOL a0);
void *allocConfigDSSoftwareFeature(HeapID heapId, u32 size, const char *file, u16 line);
void GFL_NetFreeAligned32(void *ptr);
// Record and read back the offset of BG 1 of the main engine, which bg_sys.c sets whenever it changes
void GFL_NetSetBG1Offset(int x, int y);
void GFL_NetGetBG1Offset(int *x, int *y);
void GFL_NetSetInitData(const GFLNetInitData *pNetInit);
void GFL_NetClearCallbacks(void);
BOOL GFL_NetHasError(void);
void GFL_NetMoveIcon(int x, int y);
void GFL_NetResetIconPos(void);
void GFL_NetSetRejectNegotiated(BOOL a0);

#endif // POKEBW2_GFL_NET_H

#ifndef POKEBW2_GFL_NET_HANDLE_H
#define POKEBW2_GFL_NET_HANDLE_H

#include "types.h"
#include "struct_decls.h"

// A handle for each machine and one for the server: the exchange of MAC addresses and IDs when a machine connects,
// the timing numbers that synchronize the machines, and data a machine shares

#define GFL_NET_HANDLE_MAX 9
#define GFL_NET_NETID_SERVER 0xff

enum {
    NET_HANDLE_STATE_NONE,
    NET_HANDLE_STATE_1,
    NET_HANDLE_STATE_SEND_NEGOTIATION,
    // The machine's negotiation has been accepted
    NET_HANDLE_STATE_NEGOTIATED = 5,
    NET_HANDLE_STATE_REJECTED = 7,
};

// What a machine sends to the server when it connects
typedef struct {
    u8 serverMac[6];
    u8 mac[6];
    u8 netId;
    u8 valid;
    // The command bases of the machine and of the server, which must match the machine's own
    u8 machineCommandBase;
    u8 serverCommandBase;
} NetNegotiation;

struct NetHandle {
    void *data;
    u32 dataSize;
    NetNegotiation *negotiations[GFL_NET_HANDLE_MAX];
    struct {
        u8 netId;
        u8 pending;
    } replies[8];
    u8 unk3C[2];
    // The machines whose negotiations have been sent
    u16 negotiationsSent;
    u16 serverNegotiationsSent;
    u8 unk42[2];
    u16 timingRecv;
    u16 timingSend;
    // The machines that the timing is sent to, which command 7 sends with it
    u8 timingNetIds;
    u8 timingSendPending;
    u8 state;
    u8 unk4B[3];
    u8 infoPending;
    u8 unk4F;
};

// The machine with a handle, or GFL_NET_NETID_SERVER
int NetHandle_GetNetId(NetHandle *handle);
// Create and free the handles; the argument is not used
void NetHandle_InitAll(void *sys);
void NetHandle_FreeAll(void *sys);
NetHandle *NetHandle_Get(int netId);
// This machine's handle
NetHandle *NetHandle_GetOwn(void);
BOOL NetHandle_IsNegotiated(NetHandle *handle);
u8 NetHandle_GetState(NetHandle *handle);
// The machines whose negotiations have been accepted
int NetHandle_CountNegotiated(void);
void NetHandle_RequestReply(int netId);
BOOL NetHandle_SendNegotiation(void);
// Command handlers: a machine's timing number, negotiation, and shared data
void NetHandle_RecvTimingFromMachine(int netId, int size, const void *data, void *work, NetHandle *handle);
void NetHandle_RecvTimingFromServer(int netId, int size, const void *data, void *work, NetHandle *handle);
// Sends a timing number to synchronize on, which NetHandle_IsTimingRecv and NetHandle_IsTimingPairRecv check for
void NetHandle_SendTiming(NetHandle *handle, u16 timing);
void NetHandle_SendTimingPair(NetHandle *handle, u32 a1, u32 a2);
BOOL NetHandle_IsTimingRecv(NetHandle *handle, u16 timing);
BOOL NetHandle_IsTimingPairRecv(NetHandle *handle, u32 a1, u32 a2);
void NetHandle_Update(void);
void NetHandle_RecvNegotiation(int netId, int size, u8 *data, void *work, NetHandle *handle);
void NetHandle_RecvNegotiationReply(int netId, int size, NetNegotiation *negotiation, void *work, NetHandle *handle);
void NetHandle_RecvForget(int netId, int size, u8 *data);
// Forgets a machine, as when it disconnects
void NetHandle_Forget(int netID);
void NetHandle_RecvData(int netID, int size, const void *data, void *work, NetHandle *handle);
void NetHandle_SendTimingPairToMachines(NetHandle *handle, int a1, int a2, int a3);
void NetHandle_SetNegotiationCommandBase(NetHandle *handle, int value);

#endif // POKEBW2_GFL_NET_HANDLE_H

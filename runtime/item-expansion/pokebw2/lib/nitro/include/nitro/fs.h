#ifndef POKEBW2_NITRO_FS_H
#define POKEBW2_NITRO_FS_H

#include "types.h"
#include "nitro/mi.h"
#include "nitro/os.h"

// NitroSDK's file system (TwlSDK's libfs): the files, the archives and their command queue, the ROM archive and the
// overlays

// What a command of the file system returns. A command that an archive runs apart from the caller's thread returns
// FS_RESULT_PROC_ASYNC and ends later, through FS_NotifyArchiveAsyncEnd
typedef enum FSResult {
    FS_RESULT_SUCCESS = 0,
    FS_RESULT_FAILURE = 1,
    FS_RESULT_BUSY = 2,
    FS_RESULT_CANCELED = 3,
    FS_RESULT_UNSUPPORTED = 4,
    FS_RESULT_ERROR = 5,
    FS_RESULT_INVALID_PARAMETER = 6,
    // What the ROM archive answers to opening a range of the part that only the DSi mode reads
    FS_RESULT_PERMISSION_DENIED = 9,
    FS_RESULT_NO_ENTRY = 11,
    FS_RESULT_PROC_ASYNC = 0x100,
    // What an archive's command hook (FS_ARCHIVE_PROC_FUNC) returns to leave the command to the archive's own
    // functions, this time (UNKNOWN) or for good (DEFAULT, which clears the command's bit of the hook's mask)
    FS_RESULT_PROC_UNKNOWN = 0x101,
    FS_RESULT_PROC_DEFAULT = 0x102,
} FSResult;

// The commands that a file sends to its archive, which runs one of the functions of the archive's interface. FSFile's
// stat holds the command in its second byte. The game uses 0, 1, 4, 6, 7, 8 and 13 to 16 (to read and write a file, to
// find a path, to open a file by number, by range and by path, to close it, to seek in it and to ask its length and
// position). 9 to 12, 17, 18 and FS_COMMAND_INVALID are the events, which run at once and return nothing. The
// commands from 19 on act on paths and on the archive; no function of the game sends them. The ROM archive has
// functions for 19, 23 (the information of a path), 28 (the archive's resources) and 32 and 33 (opening and closing a
// directory by path). The names are TwlSDK's, which the other commands' arguments fit; 29's is not known, and the
// arguments of the commands that the ROM archive lacks are left as the words an interface function receives
typedef enum FSCommandType {
    FS_COMMAND_READFILE = 0,
    FS_COMMAND_WRITEFILE = 1,
    FS_COMMAND_SEEKDIR = 2,
    FS_COMMAND_READDIR = 3,
    FS_COMMAND_FINDPATH = 4,
    FS_COMMAND_GETPATH = 5,
    FS_COMMAND_OPENFILEFAST = 6,
    FS_COMMAND_OPENFILEDIRECT = 7,
    FS_COMMAND_CLOSEFILE = 8,
    FS_COMMAND_ACTIVATE = 9,
    FS_COMMAND_IDLE = 10,
    FS_COMMAND_SUSPEND = 11,
    FS_COMMAND_RESUME = 12,
    FS_COMMAND_OPENFILE = 13,
    FS_COMMAND_SEEKFILE = 14,
    FS_COMMAND_GETFILELENGTH = 15,
    FS_COMMAND_GETFILEPOSITION = 16,
    FS_COMMAND_MOUNT = 17,
    FS_COMMAND_UNMOUNT = 18,
    FS_COMMAND_GETARCHIVECAPS = 19,
    FS_COMMAND_CREATEFILE = 20,
    FS_COMMAND_DELETEFILE = 21,
    FS_COMMAND_RENAMEFILE = 22,
    FS_COMMAND_GETPATHINFO = 23,
    FS_COMMAND_SETPATHINFO = 24,
    FS_COMMAND_CREATEDIRECTORY = 25,
    FS_COMMAND_DELETEDIRECTORY = 26,
    FS_COMMAND_RENAMEDIRECTORY = 27,
    FS_COMMAND_GETARCHIVERESOURCE = 28,
    FS_COMMAND_29 = 29,
    FS_COMMAND_FLUSHFILE = 30,
    FS_COMMAND_SETFILELENGTH = 31,
    FS_COMMAND_OPENDIRECTORY = 32,
    FS_COMMAND_CLOSEDIRECTORY = 33,
    FS_COMMAND_SETSEEKCACHE = 34,
    // What a file that has no command holds
    FS_COMMAND_INVALID = 35,
} FSCommandType;

// The room that an archive's interface has for commands. The ROM's has the 35 of FSCommandType, and NULL for the rest
#define FS_COMMAND_MAX 64

typedef struct FSArchive FSArchive;
typedef struct FSFile FSFile;

// A file by archive and number: NitroSDK's FS_ConvertPathToFileID and FS_OpenFileFast, and FS_OpenFileEx (which opens
// with a mode)
typedef struct FSFileID {
    FSArchive *arc;
    u32 file_id;
} FSFileID;

// Where a directory is read: its number, the number that the next file in it has, and where its next entry is in the
// archive's name table
typedef struct FSDirPos {
    FSArchive *arc;
    u16 own_id;
    u16 index;
    u32 pos;
} FSDirPos;

// What a directory's entry is: a file, by archive and number, or a directory, by position
typedef union FSEntryId {
    FSFileID file;
    FSDirPos dir;
} FSEntryId;

// The longest name that a directory entry of the ROM's name table holds
#define FS_FILE_NAME_MAX 127

// A directory entry as the archive's name table has it
typedef struct FSDirEntry {
    FSEntryId id;
    u32 is_directory;
    u32 name_len;
    char name[FS_FILE_NAME_MAX + 1];
} FSDirEntry;

// What an archive of the TWL file system tells about a path (FS_COMMAND_GETPATHINFO) and about a directory entry
// (FS_COMMAND_READDIR through the interface), and about itself (FS_COMMAND_GETARCHIVERESOURCE): NitroSDK's (TwlSDK's)
// FSPathInfo, FSDirectoryEntryInfo and FSArchiveResource
#define FS_ATTRIBUTE_IS_DIRECTORY 0x100
#define FS_ATTRIBUTE_IS_ARCHIVE_ENTRY 0x200 // set on every path that the ROM archive reports
#define FS_ATTRIBUTE_IS_PROTECTED 0x400     // a file in the part of the ROM that only the DSi mode reads

#define FS_ENTRY_SHORTNAME_MAX 16
#define FS_ENTRY_LONGNAME_MAX 260

typedef struct FSDateTime {
    u32 year;
    u32 month;
    u32 day;
    u32 hour;
    u32 minute;
    u32 second;
} FSDateTime;

typedef struct FSPathInfo {
    u32 attributes;
    FSDateTime atime;
    FSDateTime mtime;
    FSDateTime ctime;
    u32 filesize;
    u32 id;
} FSPathInfo;

typedef struct FSDirectoryEntryInfo {
    char shortname[FS_ENTRY_SHORTNAME_MAX];
    u32 shortnameLength;
    char longname[FS_ENTRY_LONGNAME_MAX];
    u32 longnameLength;
    u32 attributes;
    FSDateTime atime;
    FSDateTime mtime;
    FSDateTime ctime;
    u32 filesize;
    u32 id;
} FSDirectoryEntryInfo;

typedef struct FSArchiveResource {
    u64 totalSize;
    u64 availableSize;
    u64 maxFileSize;
    u64 maxDirectorySize;
    u32 unk_20[4];
} FSArchiveResource;

// The functions with which an archive runs its commands, indexed by command number (FSi_InvokeCommand tests the entry
// of the command before it calls it). An entry that is NULL makes its command FS_RESULT_UNSUPPORTED. The functions
// that return void are the events
typedef union FSArchiveInterface {
    struct {
        FSResult (*readFile)(FSArchive *arc, FSFile *file, void *buffer, u32 *length);
        FSResult (*writeFile)(FSArchive *arc, FSFile *file, const void *buffer, u32 *length);
        FSResult (*seekDirectory)(FSArchive *arc, FSFile *file, u32 id, u32 position);
        FSResult (*readDirectory)(FSArchive *arc, FSFile *file, FSDirectoryEntryInfo *entry);
        FSResult (*findPath)(FSArchive *arc, u32 baseDirId, const char *path, u32 *targetId, BOOL isDirectory);
        FSResult (*getPath)(FSArchive *arc, FSFile *file, u32 arg0, char *buffer, u32 *length);
        FSResult (*openFileFast)(FSArchive *arc, FSFile *file, u32 fileId, u32 arg1);
        FSResult (*openFileDirect)(FSArchive *arc, FSFile *file, u32 top, u32 bottom, u32 *fileId);
        FSResult (*closeFile)(FSArchive *arc, FSFile *file);
        void (*activate)(FSArchive *arc);
        void (*idle)(FSArchive *arc);
        void (*suspend)(FSArchive *arc);
        void (*resume)(FSArchive *arc);
        FSResult (*openFile)(FSArchive *arc, FSFile *file, u32 baseDirId, const char *path, u32 mode);
        FSResult (*seekFile)(FSArchive *arc, FSFile *file, s32 *offset, int whence);
        FSResult (*getFileLength)(FSArchive *arc, FSFile *file, u32 *length);
        FSResult (*getFilePosition)(FSArchive *arc, FSFile *file, u32 *position);
        void (*mount)(FSArchive *arc);
        void (*unmount)(FSArchive *arc);
        FSResult (*getArchiveCaps)(FSArchive *arc, u32 *arg0);
        FSResult (*createFile)(FSArchive *arc, u32 arg0, u32 arg1, u32 arg2);
        FSResult (*deleteFile)(FSArchive *arc, u32 arg0, u32 arg1);
        FSResult (*renameFile)(FSArchive *arc, u32 arg0, u32 arg1, u32 arg2, u32 arg3);
        FSResult (*getPathInfo)(FSArchive *arc, u32 baseDirId, const char *path, FSPathInfo *info);
        FSResult (*setPathInfo)(FSArchive *arc, u32 arg0, u32 arg1, u32 arg2);
        FSResult (*createDirectory)(FSArchive *arc, u32 arg0, u32 arg1, u32 arg2);
        FSResult (*deleteDirectory)(FSArchive *arc, u32 arg0, u32 arg1);
        FSResult (*renameDirectory)(FSArchive *arc, u32 arg0, u32 arg1, u32 arg2, u32 arg3);
        FSResult (*getArchiveResource)(FSArchive *arc, FSArchiveResource *resource);
        void *command29;
        FSResult (*flushFile)(FSArchive *arc, FSFile *file);
        FSResult (*setFileLength)(FSArchive *arc, FSFile *file, u32 arg0);
        FSResult (*openDirectory)(FSArchive *arc, FSFile *file, u32 baseDirId, const char *path, u32 arg2);
        FSResult (*closeDirectory)(FSArchive *arc, FSFile *file);
        FSResult (*setSeekCache)(FSArchive *arc, FSFile *file, u32 arg0, u32 arg1);
    };
    void *command[FS_COMMAND_MAX];
} FSArchiveInterface;

// The words that a command's FSFile.argument holds, for the commands the game sends
typedef struct FSReadFileArgs {
    void *buffer;
    u32 length;
} FSReadFileArgs;

typedef struct FSWriteFileArgs {
    const void *buffer;
    u32 length;
} FSWriteFileArgs;

typedef struct FSFindPathArgs {
    u32 baseDirId;
    const char *path;
    u32 targetId; // where the archive writes the number of the directory or file found
    BOOL isDirectory;
} FSFindPathArgs;

typedef struct FSOpenFileFastArgs {
    u32 fileId;
    u32 unk_04;
} FSOpenFileFastArgs;

typedef struct FSOpenFileDirectArgs {
    u32 fileId;
    u32 top;
    u32 bottom;
    u32 unk_0c;
} FSOpenFileDirectArgs;

typedef struct FSOpenFileArgs {
    u32 baseDirId;
    const char *path;
    u32 mode;
} FSOpenFileArgs;

typedef struct FSSeekFileArgs {
    s32 offset;
    int whence;
} FSSeekFileArgs;

// Both FS_COMMAND_GETFILELENGTH and FS_COMMAND_GETFILEPOSITION
typedef struct FSGetFileValueArgs {
    u32 value;
} FSGetFileValueArgs;

// And the commands that no function of the game sends, as an interface function takes them
typedef struct FSGetPathArgs {
    u32 unk_00;
    char *buffer;
    u32 length; // the size of the buffer, and the length of the path
} FSGetPathArgs;

typedef struct FSGetPathInfoArgs {
    u32 baseDirId;
    const char *path;
    FSPathInfo *info;
} FSGetPathInfoArgs;

typedef struct FSGetArchiveResourceArgs {
    FSArchiveResource *resource;
} FSGetArchiveResourceArgs;

typedef struct FSOpenDirectoryArgs {
    u32 baseDirId;
    const char *path;
    u32 unk_08; // passed on, and not used by the ROM archive's function
} FSOpenDirectoryArgs;

// The bits of FSArchive.flag
#define FS_ARCHIVE_FLAG_REGISTER 0x01   // its name is in the list of archives
#define FS_ARCHIVE_FLAG_LOADED 0x02     // its interface is set; FS_FindArchive only finds a mounted one
#define FS_ARCHIVE_FLAG_TABLE_LOAD 0x04 // its tables were loaded into memory (FS_LoadArchiveTables)
#define FS_ARCHIVE_FLAG_SUSPEND 0x08    // it does not start commands
#define FS_ARCHIVE_FLAG_RUNNING 0x10    // it has run FS_COMMAND_ACTIVATE and not yet FS_COMMAND_IDLE
#define FS_ARCHIVE_FLAG_CANCELING 0x20  // a file asked to cancel its command
#define FS_ARCHIVE_FLAG_SUSPENDING 0x40 // FS_SuspendArchive waits for the running command to end
#define FS_ARCHIVE_FLAG_UNLOADING 0x80  // it is being unmounted and takes no more commands

// An archive's functions to read and write its storage: the position counts from the archive's base. The default ones
// copy from and to memory at the base
typedef FSResult (*FS_ARCHIVE_READ_FUNC)(FSArchive *arc, void *buffer, u32 position, u32 length);
typedef FSResult (*FS_ARCHIVE_WRITE_FUNC)(FSArchive *arc, const void *buffer, u32 position, u32 length);

// A hook that an archive runs a command through before the default one: it returns FS_RESULT_PROC_UNKNOWN to leave the
// command to the default
typedef FSResult (*FS_ARCHIVE_PROC_FUNC)(FSFile *file, FSCommandType command);

// What an archive that has a file allocation table and a name table keeps after the common part of FSArchive; its
// userdata points here. The tables are read from the storage, at positions counted from the base, or from memory once
// FS_LoadArchiveTables loaded them: fat and fnt are then addresses, and the first positions are kept in the backups
typedef struct FSArchiveTables {
    u32 base;
    u32 fat;
    u32 fat_size;
    u32 fnt;
    u32 fnt_size;
    u32 fat_bak;
    u32 fnt_bak;
    void *load_mem; // where FS_LoadArchiveTables put the tables, NULL if it did not
    FS_ARCHIVE_READ_FUNC read_func;
    FS_ARCHIVE_WRITE_FUNC write_func;
    u32 table_func;
    FS_ARCHIVE_PROC_FUNC proc;
    u32 proc_flag; // the commands (1 << FSCommandType) that proc is run for
} FSArchiveTables;

// A file system's archive, such as "rom": a name, and the queue of the commands that its files send, run one at a time
// through its interface
struct FSArchive {
    union {
        char name[4];   // a name of up to 3 characters, in place
        char *longName; // a longer one, in the name pool; name[3] is then the pointer's high byte
    };
    FSArchive *next;       // the next archive of the list
    FSFile *list;          // the files with a command, the one at the head running it
    OSThreadQueue queue;   // where FS_SuspendArchive waits
    u32 flag;              // FS_ARCHIVE_FLAG_*
    FSCommandType command; // the last command that ended
    FSResult result;       // and what it returned
    void *userdata;        // what the archive's functions work on
    const FSArchiveInterface *vtbl;
    FSArchiveTables tables;
};

// The bits of FSFile.stat, under the command in bits 8 to 15
#define FS_FILE_STATUS_BUSY 0x01      // it has a command that did not end
#define FS_FILE_STATUS_CANCEL 0x02    // it asked to cancel it
#define FS_FILE_STATUS_BLOCKING 0x04  // a thread waits for it
#define FS_FILE_STATUS_ENDED 0x08     // the archive ended the command that a thread waits for
#define FS_FILE_STATUS_IS_FILE 0x10   // it is an open file
#define FS_FILE_STATUS_IS_DIR 0x20    // it is an open directory
#define FS_FILE_STATUS_OPERATING 0x40 // its command was started
#define FS_FILE_STATUS_COMMAND_SHIFT 8
// What a command sets and its end clears
#define FS_FILE_STATUS_PROGRESS_MASK 0xcf

// What a file is, once it is open: a range of its archive's data and the position in it
typedef struct FSFileRange {
    u32 fileId;
    s32 top;
    s32 bottom;
    s32 position;
} FSFileRange;

// And a directory: where it is read, and the number of its parent (of the root: the number of directories)
typedef struct FSDirectoryState {
    FSDirPos pos;
    u32 parentId;
} FSDirectoryState;

typedef union FSFileProperty {
    FSFileRange file;
    FSDirectoryState dir;
} FSFileProperty;

// Where FS_COMMAND_GETPATH writes the path, the size of the buffer, and what it tells of the path: its length with the
// terminator, and the number of its directory
typedef struct FSPathBuffer {
    char *buffer;
    u32 length;
    u16 pathLength;
    u16 dirId;
} FSPathBuffer;

// Where FS_COMMAND_READDIR puts the entry it reads, and whether it leaves out the entry's name
typedef struct FSDirReadArgs {
    FSDirEntry *entry;
    BOOL skipName;
} FSDirReadArgs;

// The range of the archive that FS_COMMAND_OPENFILEDIRECT opens, and the number it is given
typedef struct FSFileRangeArgs {
    u32 top;
    u32 bottom;
    u32 fileId;
} FSFileRangeArgs;

// The words that the default commands of an archive with tables work on, which the interface functions set in the
// file before they run the command (FSi_TranslateCommand)
typedef union FSFileCommandArgs {
    struct {
        void *buffer;
        u32 requested; // the length that was asked for
        u32 length;    // and what the file has left of it
    } readFile;
    struct {
        const void *buffer;
        u32 requested;
        u32 length;
    } writeFile;
    FSDirPos seekDirectory;
    FSDirReadArgs readDirectory;
    struct {
        FSDirPos start;
        const char *path;
        BOOL isDirectory;
        FSEntryId *result;
    } findPath;
    FSPathBuffer getPath;
    FSFileID openFileFast;
    FSFileRangeArgs openFileDirect;
} FSFileCommandArgs;

struct FSFile {
    FSFile *next;         // the next file of its archive's queue
    FSFileProperty *prop; // the property below, once the file or directory is open
    FSArchive *arc;
    u32 stat;
    void *argument;      // the words of the command, such as an FSReadFileArgs
    FSResult error;      // the result of the command, FS_RESULT_BUSY while it runs
    OSThreadQueue queue; // where a thread waits for the command
    FSFileProperty body;
    FSFileCommandArgs arg;
};

// NitroSDK's FS_GetResultCode: what the file's last command returned
static inline FSResult FS_GetResultCode(volatile const FSFile *file) {
    return file->error;
}

// The SDK's tests of a file's and an archive's state. Other threads and the end of an asynchronous command change
// the stat and the flag, so the SDK reads them through volatile pointers
// NitroSDK's FS_IsBusy: whether the file has a command that did not end
static inline BOOL FS_IsBusy(volatile const FSFile *file) {
    return (file->stat & FS_FILE_STATUS_BUSY) ? TRUE : FALSE;
}

// NitroSDK's FS_IsCanceling: whether the file's command is being canceled
static inline BOOL FS_IsCanceling(volatile const FSFile *file) {
    return (file->stat & FS_FILE_STATUS_CANCEL) ? TRUE : FALSE;
}

// NitroSDK's FS_IsDir: whether the file is an open directory
static inline BOOL FS_IsDir(volatile const FSFile *file) {
    return (file->stat & FS_FILE_STATUS_IS_DIR) ? TRUE : FALSE;
}

// NitroSDK's FS_IsFile: whether the file is open, as FS_IsDir says it of a directory
static inline BOOL FS_IsFile(volatile const FSFile *file) {
    return (file->stat & FS_FILE_STATUS_IS_FILE) ? TRUE : FALSE;
}

// NitroSDK's FS_IsArchiveLoaded: whether the archive is mounted
static inline BOOL FS_IsArchiveLoaded(volatile const FSArchive *arc) {
    return (arc->flag & FS_ARCHIVE_FLAG_LOADED) ? TRUE : FALSE;
}

// NitroSDK's FS_IsArchiveSuspended: whether the archive is suspended
static inline BOOL FS_IsArchiveSuspended(volatile const FSArchive *arc) {
    return (arc->flag & FS_ARCHIVE_FLAG_SUSPEND) ? TRUE : FALSE;
}

// Where FS_SeekFile counts the offset from
typedef enum {
    FS_SEEK_SET = 0,
    FS_SEEK_CUR = 1,
    FS_SEEK_END = 2,
} FSSeekFileMode;

void FS_InitFile(FSFile *file);                      // swan's finit
BOOL FS_OpenFile(FSFile *file, const char *path);    // swan's romfs_fopen
u32 FS_GetFileLength(FSFile *file);                  // swan's romfs_fgetsize
u32 FS_GetLength(FSFile *file);                      // swan's GetFileSize
s32 FS_ReadFile(FSFile *file, void *dest, s32 size); // swan's romfs_fread
s32 FS_WriteFile(FSFile *file, const void *src, s32 size);
BOOL FS_CloseFile(FSFile *file);                                   // swan's romfs_fclose
BOOL FS_SeekFile(FSFile *file, s32 offset, FSSeekFileMode whence); // swan's romfs_fseek
BOOL FS_CreateFileFromMemory(FSFile *file, void *data, u32 size);  // swan's extfs_fopen
// The position in the file
u32 FS_GetFilePosition(FSFile *file); // swan's romfs_ftell
// The ROM archive's shortcuts for the length and the position of a file: they set *value and return TRUE when the
// file's archive has the ROM interface, and return FALSE (and leave the command to be sent) otherwise
BOOL FSi_GetFileLengthIfProc(FSFile *file, u32 *length);
BOOL FSi_GetFilePositionIfProc(FSFile *file, u32 *position);
// Opens a file that is a range of an archive's data, from start to end
BOOL FS_OpenFileDirect(FSFile *file, FSArchive *archive, u32 start, u32 end, u32 fileId); // swan's fopen_raw
// The archive of a name of the given length, or NULL. NitroSDK's FS_FindArchive
FSArchive *FS_FindArchive(const char *name, int nameLength);
// A field of the file: where its data starts in its archive. NitroSDK's FS_GetFileImageTop
u32 FS_GetFileImageTop(const FSFile *file);

#define FS_FILEMODE_R 1

BOOL FS_ConvertPathToFileID(FSFileID *fileId, const char *path); // swan's fs_resolve_file
BOOL FS_OpenFileFast(FSFile *file, FSFileID fileId);             // swan's romfs_fopen_id
BOOL FS_OpenFileEx(FSFile *file, const char *path, u32 mode);    // swan's romfs_fopen_core
// NitroSDK's FS_CancelFile: asks the file's archive to stop the command running on it
void FS_CancelFile(FSFile *file);

// Overlays: NitroSDK's FS_LoadOverlayInfo, FS_LoadOverlay, FS_UnloadOverlay and FS_SetDefaultDMA.
// The target is the processor, MI_PROCESSOR_ARM9 (nitro/mi.h)
#define FS_DMA_NOT_USE 0xffffffff

// The number of an overlay, from 0 in each processor's table
typedef u32 FSOverlayID;

// The bits of FSOverlayInfo.flag. An image that is compressed expands in place (backward LZ). One with a digest in the
// table of the build has it checked, unless the game booted from the ROM
#define FS_OVERLAY_FLAG_COMP 0x01
#define FS_OVERLAY_FLAG_AUTH 0x02

// The size of an overlay's header in a table of them, in the ROM or in memory, which FSOverlayInfo starts with
#define FS_OVERLAY_HEADER_SIZE 0x20

// An overlay's header, as the ROM's table has it, and what is learned about it when it is read: the processor, and
// where its file starts in the ROM and how long it is
typedef struct FSOverlayInfo {
    u32 id;
    u8 *ramAddress;            // where the image is loaded
    u32 ramSize;               // the size of the image in memory, uncompressed
    u32 bssSize;               // and of the zeroed data that follows it
    void (**sinitStart)(void); // the static initializers, to be called in order
    void (**sinitEnd)(void);
    u32 fileId;
    u32 compressedSize : 24; // the size of the stored image, when it is compressed
    u32 flag : 8;            // FS_OVERLAY_FLAG_*
    MIProcessor target;
    u32 filePos;
    u32 fileSize;
} FSOverlayInfo;

BOOL FS_LoadOverlayInfo(FSOverlayInfo *info, MIProcessor target, FSOverlayID id); // swan's sys_read_overlay_header
BOOL FS_LoadOverlay(MIProcessor target, FSOverlayID id);                          // swan's sys_load_overlay
BOOL FS_UnloadOverlay(MIProcessor target, FSOverlayID id);                        // swan's sys_unload_overlay
u32 FS_SetDefaultDMA(u32 dma);                                                    // swan's fs_set_dma_id

// The digests of the overlays that the build makes, one of 20 bytes for each overlay in the order of their numbers, and
// the end of the table
typedef struct FSOverlayDigest {
    u8 bytes[20];
} FSOverlayDigest;

extern FSOverlayDigest SDK_OVERLAY_DIGEST[];
extern FSOverlayDigest SDK_OVERLAY_DIGEST_END[];

// The number of overlays that the build has, which the linker script defines as __OVERLAY_COUNT (NitroSDK's
// SDK_OVERLAY_NUMBER). The overlays from this number on exist only in the DSi mode
extern u32 __OVERLAY_COUNT[];
#define FS_OVERLAY_COUNT ((u32)__OVERLAY_COUNT)

// The state of the overlays: NitroSDK's FSi_InitOverlay, which sets it up once the archive "rom" exists
void FSi_InitOverlay(void);
// NitroSDK's FSi_GetOverlayBinarySize: the size of an overlay's image in the ROM, without its zeroed data
u32 FSi_GetOverlayBinarySize(const FSOverlayInfo *info); // swan's sys_get_overlay_size
// NitroSDK's FS_ClearOverlayImage: invalidates the caches over the overlay's memory and clears its zeroed data
void FS_ClearOverlayImage(FSOverlayInfo *info); // swan's sys_prepare_overlay_area
// NitroSDK's FS_GetOverlayFileID: the archive and the number of the overlay's file
FSFileID FS_GetOverlayFileID(const FSOverlayInfo *info); // swan's sys_get_overlay_file_id
// NitroSDK's FS_LoadOverlayImage: reads the overlay's image into its memory
BOOL FS_LoadOverlayImage(FSOverlayInfo *info); // swan's sys_mount_overlay
// NitroSDK's FS_StartOverlay: checks the image's digest, expands it and calls its static initializers
void FS_StartOverlay(FSOverlayInfo *info); // swan's sys_start_overlay
// NitroSDK's FS_EndOverlay: calls the destructors of the objects that the overlay made, and forgets them
void FS_EndOverlay(FSOverlayInfo *info);         // swan's sys_call_ovl_dtors
BOOL FS_UnloadOverlayImage(FSOverlayInfo *info); // swan's sys_unmount_overlay

// An archive with a file allocation table and a name table (fs_command_default.c): NitroSDK's FS_LoadArchive, which
// gives the archive its tables (counted from the base) and the functions that read and write the storage, NULL for the
// ones that copy from and to memory at the base, and mounts it
// swan's fs_bind
BOOL FS_LoadArchive(FSArchive *arc, u32 base, u32 fat, u32 fatSize, u32 fnt, u32 fntSize, FS_ARCHIVE_READ_FUNC readFunc,
                    FS_ARCHIVE_WRITE_FUNC writeFunc);
// NitroSDK's FS_UnloadArchive: unmounts the archive
BOOL FS_UnloadArchive(FSArchive *arc);
// NitroSDK's FS_SetArchiveProc: sets the hook that is run for the commands of the mask, 1 << FSCommandType, before the
// archive's own. Neither goes without the other
void FS_SetArchiveProc(FSArchive *arc, FS_ARCHIVE_PROC_FUNC proc, u32 procMask);
// NitroSDK's FS_LoadArchiveTables: copies the archive's tables into the memory given, which keeps them for reads from
// then on. Returns the size of memory it needs, and loads them if it was given that much
u32 FS_LoadArchiveTables(FSArchive *arc, void *memory, u32 memorySize);
// NitroSDK's FS_UnloadArchiveTables: back to reading the tables from the storage. Returns the memory they were in
void *FS_UnloadArchiveTables(FSArchive *arc);
u32 FS_GetArchiveBase(const FSArchive *arc);
// Whether the ROM archive holds a file that starts at the position in the part of the ROM that only the DSi mode reads
// (fs_rom.c)
BOOL FSi_IsDsiOnlyRomOffset(const FSArchive *arc, u32 position);

// The archives and the command queue: NitroSDK's FS_RegisterArchiveName (the longest name is 15
// characters), FS_ReleaseArchiveName, FS_InitArchive, FS_SuspendArchive, FS_ResumeArchive, FSi_SendCommand (with
// blocking set, it returns after the command ended), FS_NotifyArchiveAsyncEnd, FS_SetCurrentDirectory,
// FSi_NormalizePath (which returns the archive a path is in, with the number of the directory it starts at and the path
// inside the archive), FS_GetArchiveName and FSi_IncrementSjisPositionToSlash
#define FS_ARCHIVE_SHORT_NAME_LEN_MAX 3 // the longest name that the archive holds in place
#define FS_ARCHIVE_NAME_LEN_MAX 15
// TwlSDK's FS_ARCHIVE_FULLPATH_MAX: the longest full path, an archive's name, ':', '/' and an entry's long name
#define FS_ARCHIVE_FULLPATH_MAX (FS_ARCHIVE_NAME_LEN_MAX + 1 + 1 + FS_ENTRY_LONGNAME_MAX)
#define FS_PATH_BUFFER_SIZE 0x104

void FS_InitArchive(FSArchive *arc);                                           // swan's fs_create
BOOL FS_RegisterArchiveName(FSArchive *arc, const char *name, u32 nameLength); // swan's fs_open
void FS_ReleaseArchiveName(FSArchive *arc);
// The name of the archive, in place or in the pool
const char *FS_GetArchiveName(const FSArchive *arc);
// Gives an archive its interface and the data its functions use, and mounts it: runs FS_COMMAND_MOUNT. reserved,
// TwlSDK's, is unused; FS_LoadArchive passes 0
BOOL FS_MountArchive(FSArchive *arc, void *userdata, const FSArchiveInterface *vtbl, u32 reserved);
// Unmounts it: cancels its commands, runs FS_COMMAND_UNMOUNT and takes it out of FS_FindArchive's reach
BOOL FS_UnmountArchive(FSArchive *arc);
BOOL FS_SuspendArchive(FSArchive *arc);
BOOL FS_ResumeArchive(FSArchive *arc);
void FS_NotifyArchiveAsyncEnd(FSArchive *arc, FSResult result);
FSResult FSi_WaitForArchiveCompletion(FSFile *file, FSResult result);
BOOL FSi_SendCommand(FSFile *file, FSCommandType command, BOOL blocking);         // swan's fs_call_syscmd
FSArchive *FSi_NormalizePath(const char *path, u32 *baseDirId, char *normalized); // swan's fs_normalize_path
BOOL FS_SetCurrentDirectory(const char *path);
int FSi_IncrementSjisPositionToSlash(const char *path, int position);
BOOL FS_ChangeDir(const char *path);
// Opens a file that is a range of the ROM, from start, for size bytes
BOOL FS_CreateFileFromRom(FSFile *file, u32 start, u32 size); // swan's romfs_fopen_raw

// The ROM archive (fs_rom.c) and the file system as a whole (fs_api.c): NitroSDK's FSi_InitRom, which makes the
// archive "rom" with the default DMA channel (FS_DMA_NOT_USE for none); FS_Init, which runs it and the overlays' setup
// once; FS_IsAvailable; and FS_TryLoadTable, which loads the ROM archive's tables into the memory given, as
// FS_LoadArchiveTables does for any archive
void FSi_InitRom(u32 dma); // swan's fs_init_core
void FS_Init(u32 dma);     // swan's fs_init
BOOL FS_IsAvailable(void); // swan's fs_init_check
u32 FS_TryLoadTable(void *memory, u32 size);

#endif // POKEBW2_NITRO_FS_H

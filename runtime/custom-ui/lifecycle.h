#pragma once
#include <stdint.h>

namespace custom_ui {
using u8=uint8_t; using u16=uint16_t; using u32=uint32_t;
constexpr u32 Magic=0x49555750, Abi=1;
enum class Launcher:u8 { Field, Party };
enum class Phase:u8 { Closed, Preparing, Uploading, Ready, Suspending, Native, Restoring, Closing, Failed };
enum class Application:u8 { Summary, Learnset };
struct Navigation {
    u16 screen=0,focus=0xffff; u8 party=0xff,depth=0;
    struct Page {u16 screen,focus,list,scroll;u8 party,padding[3];} pages[16]={};
};
struct NativeRequest {
    u32 magic=Magic,abi=Abi,size=sizeof(NativeRequest);
    Application app=Application::Summary; u8 selected=0xff,readOnly=1,finished=0;
    void* gameSystem=nullptr; void* party=nullptr;
    // Owned argument storage remains alive until the child's End callback.
    alignas(4) u8 arguments[128]={};
};
struct Resources {void* owned=nullptr;u32 uploadBytes=0;};
struct Backend {
    void* context;
    bool (*prepare)(void*,const Navigation&,Resources*);
    // Called only by the game's scheduled display update, never main-loop code.
    bool (*upload)(void*,const Resources&,u32 offset,u32 length);
    void (*reveal)(void*,bool);
    void (*release)(void*,Resources*);
    bool (*open)(void*,NativeRequest*);
    bool (*done)(void*,NativeRequest*);
};
struct Session {
    Backend backend={}; Navigation navigation={},previousNavigation={}; NativeRequest request={};
    Resources visible={},pending={}; Phase phase=Phase::Closed;
    Launcher launcher=Launcher::Field; u8 returnSelection=0xff;
    u32 uploaded=0; bool revealed=false;
    static constexpr u32 UploadBudget=12288;
    bool begin(Backend host,Launcher from,u8 selection) {
        if(phase!=Phase::Closed)return false;
        backend=host;launcher=from;returnSelection=selection;navigation={};navigation.party=selection;
        request={};phase=Phase::Preparing;return true;
    }
    void hide() {if(revealed){backend.reveal(backend.context,false);revealed=false;}}
    void discard(Resources& r) {if(r.owned){backend.release(backend.context,&r);r={};}}
    void update() {
        switch(phase) {
        case Phase::Preparing: case Phase::Restoring:
            if(!backend.prepare(backend.context,navigation,&pending)) {
                discard(pending);if(visible.owned)navigation=previousNavigation;phase=visible.owned?Phase::Ready:Phase::Failed;return;
            }
            uploaded=0;hide();phase=Phase::Uploading;break;
        case Phase::Suspending:
            hide();discard(visible);discard(pending);
            if(backend.open(backend.context,&request))phase=Phase::Native;
            else phase=Phase::Restoring;
            break;
        case Phase::Native:
            if(backend.done(backend.context,&request)){request.finished=1;phase=Phase::Restoring;}
            break;
        case Phase::Closing: case Phase::Failed:
            hide();discard(pending);discard(visible);phase=Phase::Closed;break;
        default:break;
        }
    }
    void displayUpdate() {
        if(phase!=Phase::Uploading)return;
        const u32 left=pending.uploadBytes-uploaded,length=left>UploadBudget?UploadBudget:left;
        if(length && !backend.upload(backend.context,pending,uploaded,length)) {phase=Phase::Failed;return;}
        uploaded+=length;
        if(uploaded==pending.uploadBytes) {
            discard(visible);visible=pending;pending={};backend.reveal(backend.context,true);revealed=true;phase=Phase::Ready;
        }
    }
    bool openNative(Application app,void* gameSystem,void* party) {
        if(phase!=Phase::Ready || navigation.party>=6 || !party)return false;
        request={};request.app=app;request.selected=navigation.party;request.gameSystem=gameSystem;request.party=party;
        phase=Phase::Suspending;return true;
    }
    bool changeScreen(u16 screen) {if(phase!=Phase::Ready)return false;previousNavigation=navigation;navigation.screen=screen;phase=Phase::Preparing;return true;}
    // Child requests cannot be cancelled/free'd before their completion fence.
    bool close() {if(phase==Phase::Native || phase==Phase::Suspending)return false;phase=Phase::Closing;return true;}
};
}

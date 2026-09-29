#include "lifecycle.h"
#include <assert.h>
#include <stdio.h>
using namespace custom_ui;
struct Fixture {
    int live=0,allocated=0,freed=0,uploads=0;bool failure=false,uploadFailure=false,childDone=false,shown=false;
    NativeRequest* child=nullptr;u32 bytes=30000,transferred=0;
    Backend backend(){return {this,
        [](void* p,const Navigation&,Resources* r){auto& f=*static_cast<Fixture*>(p);if(f.failure)return false;++f.live;++f.allocated;r->owned=new int(42);r->uploadBytes=f.bytes;f.transferred=0;return true;},
        [](void* p,const Resources&,u32 at,u32 n){auto& f=*static_cast<Fixture*>(p);assert(!f.shown);assert(n<=Session::UploadBudget);assert(at==f.transferred);++f.uploads;f.transferred+=n;return !f.uploadFailure;},
        [](void* p,bool show){auto& f=*static_cast<Fixture*>(p);if(show)assert(f.transferred==f.bytes);f.shown=show;},
        [](void* p,Resources* r){auto& f=*static_cast<Fixture*>(p);delete static_cast<int*>(r->owned);--f.live;++f.freed;r->owned=nullptr;},
        [](void* p,NativeRequest* request){auto& f=*static_cast<Fixture*>(p);assert(f.live==0&&!f.shown);assert(request->readOnly==1);f.child=request;return true;},
        [](void* p,NativeRequest* request){auto& f=*static_cast<Fixture*>(p);assert(f.child==request);assert(request->readOnly==1);return f.childDone;}};}
};
int main() {
    for(int from=0;from<2;++from)for(int iteration=0;iteration<100;++iteration) {
        Fixture f;Session s;assert(s.begin(f.backend(),from?Launcher::Party:Launcher::Field,4));
        s.update();assert(s.phase==Phase::Uploading&&!f.shown);s.displayUpdate();s.displayUpdate();assert(!f.shown);s.displayUpdate();assert(f.shown&&s.phase==Phase::Ready);
        s.navigation.focus=7;s.navigation.pages[0]={2,7,10,8,4,{}};s.navigation.depth=1;
        assert(s.openNative(Application::Summary,reinterpret_cast<void*>(1),reinterpret_cast<void*>(2)));s.update();assert(s.phase==Phase::Native&&f.live==0);
        assert(!s.close());s.update();assert(!s.request.finished);f.childDone=true;s.update();assert(s.phase==Phase::Restoring);
        assert(s.navigation.focus==7&&s.navigation.pages[0].scroll==8&&s.returnSelection==4);
        s.update();while(s.phase==Phase::Uploading)s.displayUpdate();assert(s.phase==Phase::Ready);
        f.failure=true;assert(s.changeScreen(3));s.update();assert(s.phase==Phase::Ready&&f.live==1&&f.shown);
        assert(s.close());s.update();assert(s.phase==Phase::Closed&&f.live==0&&f.allocated==f.freed);
    }
    Fixture f;Session s;f.uploadFailure=true;s.begin(f.backend(),Launcher::Party,0);s.update();s.displayUpdate();assert(s.phase==Phase::Failed&&!f.shown);s.update();assert(f.live==0);
    puts("custom-ui lifecycle: 200 repeated sessions, upload fences, owned child requests, allocation failure and cleanup passed");
}

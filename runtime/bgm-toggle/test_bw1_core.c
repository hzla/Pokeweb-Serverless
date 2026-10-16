#include "bw1_stream_core.h"
#include <stdio.h>
#include <stdlib.h>
static int readFile(void *f,uint32_t at,void *out,uint32_t n){
    return !fseek(f,at,SEEK_SET)&&fread(out,1,n,f)==n;
}
int main(int argc,char **argv){
    if(argc!=4)return 2;
    FILE *f=fopen(argv[1],"rb");if(!f)return 2;
    fseek(f,0,SEEK_END);long size=ftell(f);
    PwStream stream;
    if(!PwStreamOpen(&stream,readFile,f,size))return 3;
    if(!PwStreamSeek(&stream,strtoul(argv[2],0,10)))return 4;
    uint32_t count=strtoul(argv[3],0,10);
    while(count){
        int16_t left[137],right[137],stereo[274];
        uint32_t n=count>137?137:count;
        PwStreamReadFrames(&stream,left,right,n);
        if(stream.failed)return 5;
        for(uint32_t i=0;i<n;i++){stereo[i*2]=left[i];stereo[i*2+1]=right[i];}
        if(fwrite(stereo,4,n,stdout)!=n)return 6;
        count-=n;
    }
    fclose(f);return 0;
}

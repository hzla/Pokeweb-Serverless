#include <stdint.h>
/* Small freestanding EABI division support. Denominators originate in
 * validated STRM headers; zero still has a defined fail-closed result. */
uint32_t PwDivide(uint32_t n,uint32_t d,uint32_t *remainder){
    uint32_t q=0,bit=1;
    if(!d){*remainder=0;return 0;}
    while(d<=n/2 && !(d&0x80000000u)){d<<=1;bit<<=1;}
    while(bit){if(n>=d){n-=d;q|=bit;}d>>=1;bit>>=1;}
    *remainder=n;return q;
}

/* Moves act as if the weather were sun, rain, hail or sandstorm (recipe 173,
 * Mega Sol and its variants).
 *
 * Every Gen 5 weather read (move effects such as Weather Ball, Solar Beam,
 * Thunder, Growth and the weather recovery moves; the damage weather modifier;
 * sun's freeze immunity; sandstorm's Rock Sp. Def boost; weather abilities)
 * goes through the native weather query. While the holder's own move sequence
 * runs - from the native move-start event (0x3) to move-end (0x4), which are
 * always paired - that query returns the simulated weather instead, like
 * Showdown's Pokemon.effectiveWeather() for the active Mega Sol Pokemon. This
 * includes the target's weather checks during that move. Cloud Nine / Air Lock
 * do not cancel it. Field weather, other Pokemon's moves and end-of-turn
 * effects are unchanged. Eligibility (ability not suppressed, conditions) is
 * decided when the move starts. */
PUBLIC const volatile u32 AbilityWeatherApi[1]={0}; /* copied native weather query */
#define WTX(t) ((t)(uintptr_t)AbilityWeatherApi[0])
static u32 weatherScope;
static void weatherInit(void){weatherScope=0;}
static void weatherBefore(void*f,u32 event){
 if(event==0x4){weatherScope=0;return;}
 if(event!=0x3)return;
 weatherScope=0;
 u32 user=VALUE(3);if(user>=24)return;
 void*mon=MON(f,user);
 const volatile u8*r=record(STAT(mon,17));if(!r||r[0]>ABILITY_EFFECT_SLOTS)return;
 const volatile u8*e=effects(r);
 for(u32 n=0;n<r[0];++n,e+=16)if(e[0]==173){if(e[1]>=1&&e[1]<=4&&active(r,f,mon))weatherScope=e[1];break;}
}
PUBLIC u32 AbilityWeatherQuery(void*f){
 if(weatherScope)return weatherScope;
 return WTX(u32(*)(void*))(f);
}
#ifdef ABILITY_WEATHER_TEST
/* Emulator-only evidence log; never part of a released bundle. */
typedef struct {u8 event,a,d,x;u16 move,y;u32 value;} WeatherLogEntry;
static struct {u32 magic,count;WeatherLogEntry entries[20];} weatherLog;
static void weatherRecord(u32 event,u32 a,u32 d,u32 x,u32 move,u32 y,u32 value){
 weatherLog.magic=0x4c525457;u32 n=weatherLog.count++;if(n>=20)return;
 WeatherLogEntry*e=&weatherLog.entries[n];e->event=event;e->a=a;e->d=d;e->x=x;e->move=move;e->y=y;e->value=value;
}
static void weatherAfter(void*f,u32 event){
 if(preview(f))return;
 if(event==0x3)weatherRecord(3,VALUE(3),0,weatherScope,VALUE(0x12),0,0);
 if(event==0x47)weatherRecord(0x47,VALUE(3),VALUE(4),VALUE(0x16),VALUE(0x12),weatherScope,VALUE(0x32));
 if(event==0x4b)weatherRecord(0x4b,VALUE(3),VALUE(4),0,VALUE(0x12),0,VALUE(0x32));
 if(event==0x7f)weatherRecord(0x7f,VALUE(2),0,VALUE(0x39),0,0,VALUE(0x32));
}
#else
static void weatherAfter(void*f,u32 event){(void)f;(void)event;}
#endif

	.thumb
	.syntax unified

	.type FULL_COPY_36_0x2180E0A, %object
	.type THUMB_BRANCH_36_0x21991E0, %function
	.type THUMB_BRANCH_36_0x2199248, %function
	.type THUMB_BRANCH_36_0x2199250, %function
	.type THUMB_BRANCH_36_0x2199658, %function
	.type THUMB_BRANCH_36_0x2199774, %function
	.type THUMB_BRANCH_36_0x2199780, %function

	.extern PWW_PrepareWeatherId
	.extern PWW_MaterializeWeatherDescriptor
	.extern PWW_WeatherDispatchTable
	.extern PWW_WeatherLightChange
	.extern PWW_WeatherLightSet

@ Retail treats weather ID 15 as a sentinel here. Zone headers are six bits,
@ so remove the comparison and let FIELD_WEATHER_Change/PWTH validate IDs
@ 15-63. This must be a four-byte in-place patch: a far THUMB_BRANCH occupies
@ eight bytes and would also overwrite the following mov and half of its bl.
	.global FULL_COPY_36_0x2180E0A
FULL_COPY_36_0x2180E0A:
	nop
	nop
	.size FULL_COPY_36_0x2180E0A, . - FULL_COPY_36_0x2180E0A

@ FIELD_WEATHER_Set: load/validate PWTH while preserving the raw custom ID,
@ reproduce all eight bytes overwritten by PMC's far THUMB_BRANCH stub, then
@ resume the retail implementation after the stub.
THUMB_BRANCH_36_0x21991E0:
	push {r0, r2, lr}
	movs r0, r1
	bl PWW_PrepareWeatherId
	movs r1, r0
	pop {r0, r2, r3}
	mov lr, r3
	push {r4-r7, lr}
	sub sp, #12
	movs r5, r0
	ldrh r0, [r5, #12]
	ldr r3, =0x021991E9
	bx r3
	.size THUMB_BRANCH_36_0x21991E0, . - THUMB_BRANCH_36_0x21991E0

@ FIELD_WEATHER_Change is a retail veneer over FIELD_WEATHER_LOCAL_Change.
THUMB_BRANCH_36_0x2199248:
	push {r0, lr}
	movs r0, r1
	bl PWW_PrepareWeatherId
	movs r1, r0
	pop {r0, r3}
	mov lr, r3
	ldr r3, =0x021992A1
	bx r3
	.size THUMB_BRANCH_36_0x2199248, . - THUMB_BRANCH_36_0x2199248

@ FIELD_WEATHER_ChangeNotEnvSe bypasses the public Change veneer.
THUMB_BRANCH_36_0x2199250:
	push {r4, lr}
	movs r4, r0
	movs r0, r1
	bl PWW_PrepareWeatherId
	movs r1, r0
	movs r0, r4
	ldr r3, =0x021992A1
	blx r3
	movs r0, #0
	str r0, [r4, #16]
	pop {r4, pc}
	.size THUMB_BRANCH_36_0x2199250, . - THUMB_BRANCH_36_0x2199250

@ Donor descriptors live in mutually exclusive weather overlays. Materialize
@ the custom descriptor only after the donor overlay has been loaded and just
@ before WEATHER_TASK_Start stores the pointer.
THUMB_BRANCH_36_0x2199658:
	push {r4}
	push {r0, r2, r3, lr}
	movs r0, r1
	bl PWW_MaterializeWeatherDescriptor
	movs r1, r0
	pop {r0, r2, r3, r4}
	str r1, [r0, #32]
	pop {r4}
	@ PMC's far THUMB_BRANCH veneer pushed the caller's LR before entering
	@ this hook. WEATHER_TASK_Start has three stack arguments, so leaving that
	@ word in place makes retail's [sp, #16] load the return address as the fog
	@ mode (normally producing the invalid value 3). Consume the veneer frame
	@ and let the reproduced retail prologue return directly to the caller.
	pop {r1}
	mov lr, r1
	push {r3, r4, r5, lr}
	movs r1, r0
	adds r1, #36
	ldr r3, =0x02199661
	bx r3
	.size THUMB_BRANCH_36_0x2199658, . - THUMB_BRANCH_36_0x2199658

@ All non-fog donor callbacks funnel weather-light changes through these two
@ functions. Redirect cloned members or preserve the map's default area
@ lighting based on the PWTH row. These replace the retail functions in full;
@ consume PMC's saved caller LR before returning.
THUMB_BRANCH_36_0x2199774:
	bl PWW_WeatherLightChange
	pop {r3}
	bx r3
	.size THUMB_BRANCH_36_0x2199774, . - THUMB_BRANCH_36_0x2199774

THUMB_BRANCH_36_0x2199780:
	bl PWW_WeatherLightSet
	pop {r3}
	bx r3
	.size THUMB_BRANCH_36_0x2199780, . - THUMB_BRANCH_36_0x2199780

@ Patch all five retail literal-pool references to sc_FIELD_WEATHER_DATA.
@ The +4 literals address the overlayId member of each 8-byte row.
@
@ PMC rounds ABS32 relocation sites down to a four-byte boundary. Keep these
@ relocated words aligned so the runtime relocation cannot overwrite the
@ preceding WeatherTask_Start trampoline or shift each table pointer by two
@ bytes before FULL_COPY installs it into overlay 36.
	.balign 4
	.global FULL_COPY_36_0x219923C
FULL_COPY_36_0x219923C:
	.word PWW_WeatherDispatchTable + 4
	.size FULL_COPY_36_0x219923C, . - FULL_COPY_36_0x219923C

	.global FULL_COPY_36_0x2199240
FULL_COPY_36_0x2199240:
	.word PWW_WeatherDispatchTable
	.size FULL_COPY_36_0x2199240, . - FULL_COPY_36_0x2199240

	.global FULL_COPY_36_0x2199364
FULL_COPY_36_0x2199364:
	.word PWW_WeatherDispatchTable + 4
	.size FULL_COPY_36_0x2199364, . - FULL_COPY_36_0x2199364

	.global FULL_COPY_36_0x2199368
FULL_COPY_36_0x2199368:
	.word PWW_WeatherDispatchTable
	.size FULL_COPY_36_0x2199368, . - FULL_COPY_36_0x2199368

	.global FULL_COPY_36_0x21993DC
FULL_COPY_36_0x21993DC:
	.word PWW_WeatherDispatchTable
	.size FULL_COPY_36_0x21993DC, . - FULL_COPY_36_0x21993DC

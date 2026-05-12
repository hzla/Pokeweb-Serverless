# Grouped Macro Crash Comparison

gif=/path/to/Docs/740.gif
outDir=/path/to/Port-Pokeweb/Pokeweb-Serverless/analysis/crashing-grouped-macro

## Safe Current 740 Macro
report={"sourceFrameCount":92,"normalizedFrameCount":92,"sourceFramePercent":100,"durationScale":1,"selectedSourceFrames":[0,52,74,91],"timelineFrames":[0,52,74,91],"uniquePoseCount":4,"uniqueTileCount":436,"atlasOccupancyPercent":85.2,"packingMode":"macro-blocks","maxOamsPerPose":18,"loopPlan":{"loopSearchWindow":{"startFrame":23,"endFrame":69},"loopEndFrame":24,"loopEndScore":0,"restLoopCount":3,"restLoopDuration":2500,"finishStartFrame":25},"groundValidation":{"maxAllowedBottomY":3,"maxVisibleBottomY":3,"appliedShiftY":-39},"visibilityValidation":{"frameCount":4,"invisibleFrameCount":0},"warnings":["Reduced timeline from 142 to 4 frame(s) to fit the tile/OAM budget"]}
### safe 740 NMCR
len=188 groups=2 pad=0xbeef multiOff=0x0014 hierOff=0x0024 stringOff=0x0000 extOff=0x0000
group[0] raw=08 00 08 00 00 00 00 00 nodes=8 cellAnim=8 hierarchyOffset=0x0000
  node[0] raw=00 00 00 00 00 00 20 00 seq=0 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
  node[1] raw=01 00 00 00 00 00 20 01 seq=1 x=0 y=0 attr=0x0120 cellAnim=1 visible=true
  node[2] raw=02 00 00 00 00 00 20 02 seq=2 x=0 y=0 attr=0x0220 cellAnim=2 visible=true
  node[3] raw=03 00 00 00 00 00 20 03 seq=3 x=0 y=0 attr=0x0320 cellAnim=3 visible=true
  node[4] raw=04 00 00 00 00 00 20 04 seq=4 x=0 y=0 attr=0x0420 cellAnim=4 visible=true
  node[5] raw=05 00 00 00 00 00 20 05 seq=5 x=0 y=0 attr=0x0520 cellAnim=5 visible=true
  node[6] raw=06 00 00 00 00 00 20 06 seq=6 x=0 y=0 attr=0x0620 cellAnim=6 visible=true
  node[7] raw=07 00 00 00 00 00 20 07 seq=7 x=0 y=0 attr=0x0720 cellAnim=7 visible=true
group[1] raw=08 00 08 00 40 00 00 00 nodes=8 cellAnim=8 hierarchyOffset=0x0040
  node[0] raw=00 00 00 00 00 00 20 00 seq=0 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
  node[1] raw=01 00 00 00 00 00 20 01 seq=1 x=0 y=0 attr=0x0120 cellAnim=1 visible=true
  node[2] raw=02 00 00 00 00 00 20 02 seq=2 x=0 y=0 attr=0x0220 cellAnim=2 visible=true
  node[3] raw=03 00 00 00 00 00 20 03 seq=3 x=0 y=0 attr=0x0320 cellAnim=3 visible=true
  node[4] raw=04 00 00 00 00 00 20 04 seq=4 x=0 y=0 attr=0x0420 cellAnim=4 visible=true
  node[5] raw=05 00 00 00 00 00 20 05 seq=5 x=0 y=0 attr=0x0520 cellAnim=5 visible=true
  node[6] raw=06 00 00 00 00 00 20 06 seq=6 x=0 y=0 attr=0x0620 cellAnim=6 visible=true
  node[7] raw=07 00 00 00 00 00 20 07 seq=7 x=0 y=0 attr=0x0720 cellAnim=7 visible=true
### safe 740 NANR
len=944 seq=8 totalFrames=32 seqOff=0x0018 frameOff=0x0098 valueOff=0x0198
seq[0] raw=04 00 00 00 01 00 01 00 02 00 00 00 00 00 00 00 frames=4 start=0 motion=1 target=1 mode=2 frameDataOff=0x0000
  frame[0] frameRaw=00 00 00 00 06 00 00 00 valueRaw=10 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0000 duration=6 index=16 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[1] frameRaw=10 00 00 00 06 00 00 00 valueRaw=1b 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0010 duration=6 index=27 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[2] frameRaw=20 00 00 00 06 00 00 00 valueRaw=1c 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0020 duration=6 index=28 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[3] frameRaw=30 00 00 00 06 00 00 00 valueRaw=1d 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0030 duration=6 index=29 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[1] raw=04 00 00 00 01 00 01 00 02 00 00 00 20 00 00 00 frames=4 start=0 motion=1 target=1 mode=2 frameDataOff=0x0020
  frame[0] frameRaw=40 00 00 00 06 00 00 00 valueRaw=0e 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0040 duration=6 index=14 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[1] frameRaw=50 00 00 00 06 00 00 00 valueRaw=0d 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0050 duration=6 index=13 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[2] frameRaw=60 00 00 00 06 00 00 00 valueRaw=19 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0060 duration=6 index=25 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[3] frameRaw=70 00 00 00 06 00 00 00 valueRaw=1a 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0070 duration=6 index=26 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[2] raw=04 00 00 00 01 00 01 00 02 00 00 00 40 00 00 00 frames=4 start=0 motion=1 target=1 mode=2 frameDataOff=0x0040
  frame[0] frameRaw=80 00 00 00 06 00 00 00 valueRaw=0f 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0080 duration=6 index=15 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[1] frameRaw=90 00 00 00 06 00 00 00 valueRaw=09 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0090 duration=6 index=9 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[2] frameRaw=a0 00 00 00 06 00 00 00 valueRaw=18 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x00a0 duration=6 index=24 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[3] frameRaw=b0 00 00 00 06 00 00 00 valueRaw=07 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x00b0 duration=6 index=7 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[3] raw=04 00 00 00 01 00 01 00 02 00 00 00 60 00 00 00 frames=4 start=0 motion=1 target=1 mode=2 frameDataOff=0x0060
  frame[0] frameRaw=c0 00 00 00 06 00 00 00 valueRaw=11 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x00c0 duration=6 index=17 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[1] frameRaw=d0 00 00 00 06 00 00 00 valueRaw=17 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x00d0 duration=6 index=23 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[2] frameRaw=e0 00 00 00 06 00 00 00 valueRaw=12 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x00e0 duration=6 index=18 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[3] frameRaw=f0 00 00 00 06 00 00 00 valueRaw=08 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x00f0 duration=6 index=8 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[4] raw=04 00 00 00 01 00 01 00 02 00 00 00 80 00 00 00 frames=4 start=0 motion=1 target=1 mode=2 frameDataOff=0x0080
  frame[0] frameRaw=00 01 00 00 06 00 00 00 valueRaw=0a 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0100 duration=6 index=10 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[1] frameRaw=10 01 00 00 06 00 00 00 valueRaw=04 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0110 duration=6 index=4 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[2] frameRaw=20 01 00 00 06 00 00 00 valueRaw=15 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0120 duration=6 index=21 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[3] frameRaw=30 01 00 00 06 00 00 00 valueRaw=13 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0130 duration=6 index=19 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[5] raw=04 00 00 00 01 00 01 00 02 00 00 00 a0 00 00 00 frames=4 start=0 motion=1 target=1 mode=2 frameDataOff=0x00a0
  frame[0] frameRaw=40 01 00 00 06 00 00 00 valueRaw=0c 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0140 duration=6 index=12 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[1] frameRaw=50 01 00 00 06 00 00 00 valueRaw=14 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0150 duration=6 index=20 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[2] frameRaw=60 01 00 00 06 00 00 00 valueRaw=05 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0160 duration=6 index=5 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[3] frameRaw=70 01 00 00 06 00 00 00 valueRaw=16 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0170 duration=6 index=22 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[6] raw=04 00 00 00 01 00 01 00 02 00 00 00 c0 00 00 00 frames=4 start=0 motion=1 target=1 mode=2 frameDataOff=0x00c0
  frame[0] frameRaw=80 01 00 00 06 00 00 00 valueRaw=02 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0180 duration=6 index=2 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[1] frameRaw=90 01 00 00 06 00 00 00 valueRaw=0b 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0190 duration=6 index=11 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[2] frameRaw=a0 01 00 00 06 00 00 00 valueRaw=06 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x01a0 duration=6 index=6 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[3] frameRaw=b0 01 00 00 06 00 00 00 valueRaw=03 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x01b0 duration=6 index=3 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[7] raw=04 00 00 00 01 00 01 00 02 00 00 00 e0 00 00 00 frames=4 start=0 motion=1 target=1 mode=2 frameDataOff=0x00e0
  frame[0] frameRaw=c0 01 00 00 06 00 00 00 valueRaw=00 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x01c0 duration=6 index=0 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[1] frameRaw=d0 01 00 00 06 00 00 00 valueRaw=00 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x01d0 duration=6 index=0 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[2] frameRaw=e0 01 00 00 06 00 00 00 valueRaw=01 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x01e0 duration=6 index=1 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[3] frameRaw=f0 01 00 00 06 00 00 00 valueRaw=00 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x01f0 duration=6 index=0 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
### safe 740 NMAR
len=88 seq=1 totalFrames=1 seqOff=0x0018 frameOff=0x0028 valueOff=0x0030
seq[0] raw=01 00 00 00 01 00 02 00 02 00 00 00 00 00 00 00 frames=1 start=0 motion=1 target=2 mode=2 frameDataOff=0x0000
  frame[0] frameRaw=00 00 00 00 18 00 00 00 valueRaw=00 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0000 duration=24 index=0 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0

## Reconstructed Previous Crashing Grouped 740 Macro
poseGroups=4 groupNodeCounts=7/7/8/7
timelineGroupIndexes=0,1,2,3
### crash 740 NMCR
len=308 groups=4 pad=0xbeef multiOff=0x0014 hierOff=0x0034 stringOff=0x0000 extOff=0x0000
group[0] raw=07 00 07 00 00 00 00 00 nodes=7 cellAnim=7 hierarchyOffset=0x0000
  node[0] raw=0f 00 00 00 00 00 20 00 seq=15 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
  node[1] raw=0d 00 00 00 00 00 20 01 seq=13 x=0 y=0 attr=0x0120 cellAnim=1 visible=true
  node[2] raw=0e 00 00 00 00 00 20 02 seq=14 x=0 y=0 attr=0x0220 cellAnim=2 visible=true
  node[3] raw=10 00 00 00 00 00 20 03 seq=16 x=0 y=0 attr=0x0320 cellAnim=3 visible=true
  node[4] raw=09 00 00 00 00 00 20 04 seq=9 x=0 y=0 attr=0x0420 cellAnim=4 visible=true
  node[5] raw=0b 00 00 00 00 00 20 05 seq=11 x=0 y=0 attr=0x0520 cellAnim=5 visible=true
  node[6] raw=01 00 00 00 00 00 20 06 seq=1 x=0 y=0 attr=0x0620 cellAnim=6 visible=true
group[1] raw=07 00 07 00 38 00 00 00 nodes=7 cellAnim=7 hierarchyOffset=0x0038
  node[0] raw=1a 00 00 00 00 00 20 00 seq=26 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
  node[1] raw=0c 00 00 00 00 00 20 01 seq=12 x=0 y=0 attr=0x0120 cellAnim=1 visible=true
  node[2] raw=08 00 00 00 00 00 20 02 seq=8 x=0 y=0 attr=0x0220 cellAnim=2 visible=true
  node[3] raw=16 00 00 00 00 00 20 03 seq=22 x=0 y=0 attr=0x0320 cellAnim=3 visible=true
  node[4] raw=03 00 00 00 00 00 20 04 seq=3 x=0 y=0 attr=0x0420 cellAnim=4 visible=true
  node[5] raw=13 00 00 00 00 00 20 05 seq=19 x=0 y=0 attr=0x0520 cellAnim=5 visible=true
  node[6] raw=0a 00 00 00 00 00 20 06 seq=10 x=0 y=0 attr=0x0620 cellAnim=6 visible=true
group[2] raw=08 00 08 00 70 00 00 00 nodes=8 cellAnim=8 hierarchyOffset=0x0070
  node[0] raw=1b 00 00 00 00 00 20 00 seq=27 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
  node[1] raw=18 00 00 00 00 00 20 01 seq=24 x=0 y=0 attr=0x0120 cellAnim=1 visible=true
  node[2] raw=17 00 00 00 00 00 20 02 seq=23 x=0 y=0 attr=0x0220 cellAnim=2 visible=true
  node[3] raw=11 00 00 00 00 00 20 03 seq=17 x=0 y=0 attr=0x0320 cellAnim=3 visible=true
  node[4] raw=14 00 00 00 00 00 20 04 seq=20 x=0 y=0 attr=0x0420 cellAnim=4 visible=true
  node[5] raw=04 00 00 00 00 00 20 05 seq=4 x=0 y=0 attr=0x0520 cellAnim=5 visible=true
  node[6] raw=05 00 00 00 00 00 20 06 seq=5 x=0 y=0 attr=0x0620 cellAnim=6 visible=true
  node[7] raw=00 00 00 00 00 00 20 07 seq=0 x=0 y=0 attr=0x0720 cellAnim=7 visible=true
group[3] raw=07 00 07 00 b0 00 00 00 nodes=7 cellAnim=7 hierarchyOffset=0x00b0
  node[0] raw=1c 00 00 00 00 00 20 00 seq=28 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
  node[1] raw=19 00 00 00 00 00 20 01 seq=25 x=0 y=0 attr=0x0120 cellAnim=1 visible=true
  node[2] raw=06 00 00 00 00 00 20 02 seq=6 x=0 y=0 attr=0x0220 cellAnim=2 visible=true
  node[3] raw=07 00 00 00 00 00 20 03 seq=7 x=0 y=0 attr=0x0320 cellAnim=3 visible=true
  node[4] raw=12 00 00 00 00 00 20 04 seq=18 x=0 y=0 attr=0x0420 cellAnim=4 visible=true
  node[5] raw=15 00 00 00 00 00 20 05 seq=21 x=0 y=0 attr=0x0520 cellAnim=5 visible=true
  node[6] raw=02 00 00 00 00 00 20 06 seq=2 x=0 y=0 attr=0x0620 cellAnim=6 visible=true
### crash 740 NANR
len=1208 seq=29 totalFrames=29 seqOff=0x0018 frameOff=0x01e8 valueOff=0x02d0
seq[0] raw=01 00 00 00 01 00 01 00 02 00 00 00 00 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0000
  frame[0] frameRaw=00 00 00 00 18 00 00 00 valueRaw=01 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0000 duration=24 index=1 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[1] raw=01 00 00 00 01 00 01 00 02 00 00 00 08 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0008
  frame[0] frameRaw=10 00 00 00 18 00 00 00 valueRaw=02 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0010 duration=24 index=2 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[2] raw=01 00 00 00 01 00 01 00 02 00 00 00 10 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0010
  frame[0] frameRaw=20 00 00 00 18 00 00 00 valueRaw=03 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0020 duration=24 index=3 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[3] raw=01 00 00 00 01 00 01 00 02 00 00 00 18 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0018
  frame[0] frameRaw=30 00 00 00 18 00 00 00 valueRaw=04 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0030 duration=24 index=4 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[4] raw=01 00 00 00 01 00 01 00 02 00 00 00 20 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0020
  frame[0] frameRaw=40 00 00 00 18 00 00 00 valueRaw=05 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0040 duration=24 index=5 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[5] raw=01 00 00 00 01 00 01 00 02 00 00 00 28 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0028
  frame[0] frameRaw=50 00 00 00 18 00 00 00 valueRaw=06 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0050 duration=24 index=6 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[6] raw=01 00 00 00 01 00 01 00 02 00 00 00 30 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0030
  frame[0] frameRaw=60 00 00 00 18 00 00 00 valueRaw=07 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0060 duration=24 index=7 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[7] raw=01 00 00 00 01 00 01 00 02 00 00 00 38 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0038
  frame[0] frameRaw=70 00 00 00 18 00 00 00 valueRaw=08 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0070 duration=24 index=8 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[8] raw=01 00 00 00 01 00 01 00 02 00 00 00 40 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0040
  frame[0] frameRaw=80 00 00 00 18 00 00 00 valueRaw=09 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0080 duration=24 index=9 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[9] raw=01 00 00 00 01 00 01 00 02 00 00 00 48 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0048
  frame[0] frameRaw=90 00 00 00 18 00 00 00 valueRaw=0a 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0090 duration=24 index=10 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[10] raw=01 00 00 00 01 00 01 00 02 00 00 00 50 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0050
  frame[0] frameRaw=a0 00 00 00 18 00 00 00 valueRaw=0b 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x00a0 duration=24 index=11 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[11] raw=01 00 00 00 01 00 01 00 02 00 00 00 58 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0058
  frame[0] frameRaw=b0 00 00 00 18 00 00 00 valueRaw=0c 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x00b0 duration=24 index=12 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[12] raw=01 00 00 00 01 00 01 00 02 00 00 00 60 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0060
  frame[0] frameRaw=c0 00 00 00 18 00 00 00 valueRaw=0d 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x00c0 duration=24 index=13 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[13] raw=01 00 00 00 01 00 01 00 02 00 00 00 68 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0068
  frame[0] frameRaw=d0 00 00 00 18 00 00 00 valueRaw=0e 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x00d0 duration=24 index=14 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[14] raw=01 00 00 00 01 00 01 00 02 00 00 00 70 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0070
  frame[0] frameRaw=e0 00 00 00 18 00 00 00 valueRaw=0f 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x00e0 duration=24 index=15 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[15] raw=01 00 00 00 01 00 01 00 02 00 00 00 78 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0078
  frame[0] frameRaw=f0 00 00 00 18 00 00 00 valueRaw=10 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x00f0 duration=24 index=16 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[16] raw=01 00 00 00 01 00 01 00 02 00 00 00 80 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0080
  frame[0] frameRaw=00 01 00 00 18 00 00 00 valueRaw=11 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0100 duration=24 index=17 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[17] raw=01 00 00 00 01 00 01 00 02 00 00 00 88 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0088
  frame[0] frameRaw=10 01 00 00 18 00 00 00 valueRaw=12 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0110 duration=24 index=18 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[18] raw=01 00 00 00 01 00 01 00 02 00 00 00 90 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0090
  frame[0] frameRaw=20 01 00 00 18 00 00 00 valueRaw=13 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0120 duration=24 index=19 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[19] raw=01 00 00 00 01 00 01 00 02 00 00 00 98 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x0098
  frame[0] frameRaw=30 01 00 00 18 00 00 00 valueRaw=14 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0130 duration=24 index=20 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[20] raw=01 00 00 00 01 00 01 00 02 00 00 00 a0 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x00a0
  frame[0] frameRaw=40 01 00 00 18 00 00 00 valueRaw=15 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0140 duration=24 index=21 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[21] raw=01 00 00 00 01 00 01 00 02 00 00 00 a8 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x00a8
  frame[0] frameRaw=50 01 00 00 18 00 00 00 valueRaw=16 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0150 duration=24 index=22 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[22] raw=01 00 00 00 01 00 01 00 02 00 00 00 b0 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x00b0
  frame[0] frameRaw=60 01 00 00 18 00 00 00 valueRaw=17 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0160 duration=24 index=23 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[23] raw=01 00 00 00 01 00 01 00 02 00 00 00 b8 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x00b8
  frame[0] frameRaw=70 01 00 00 18 00 00 00 valueRaw=18 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0170 duration=24 index=24 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[24] raw=01 00 00 00 01 00 01 00 02 00 00 00 c0 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x00c0
  frame[0] frameRaw=80 01 00 00 18 00 00 00 valueRaw=19 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0180 duration=24 index=25 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[25] raw=01 00 00 00 01 00 01 00 02 00 00 00 c8 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x00c8
  frame[0] frameRaw=90 01 00 00 18 00 00 00 valueRaw=1a 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0190 duration=24 index=26 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[26] raw=01 00 00 00 01 00 01 00 02 00 00 00 d0 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x00d0
  frame[0] frameRaw=a0 01 00 00 18 00 00 00 valueRaw=1b 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x01a0 duration=24 index=27 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[27] raw=01 00 00 00 01 00 01 00 02 00 00 00 d8 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x00d8
  frame[0] frameRaw=b0 01 00 00 18 00 00 00 valueRaw=1c 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x01b0 duration=24 index=28 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
seq[28] raw=01 00 00 00 01 00 01 00 02 00 00 00 e0 00 00 00 frames=1 start=0 motion=1 target=1 mode=2 frameDataOff=0x00e0
  frame[0] frameRaw=c0 01 00 00 18 00 00 00 valueRaw=1d 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x01c0 duration=24 index=29 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
### crash 740 NMAR
len=160 seq=1 totalFrames=4 seqOff=0x0018 frameOff=0x0028 valueOff=0x0048
seq[0] raw=04 00 00 00 01 00 02 00 02 00 00 00 00 00 00 00 frames=4 start=0 motion=1 target=2 mode=2 frameDataOff=0x0000
  frame[0] frameRaw=00 00 00 00 06 00 00 00 valueRaw=00 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0000 duration=6 index=0 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[1] frameRaw=10 00 00 00 06 00 00 00 valueRaw=01 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0010 duration=6 index=1 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[2] frameRaw=20 00 00 00 06 00 00 00 valueRaw=02 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0020 duration=6 index=2 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[3] frameRaw=30 00 00 00 06 00 00 00 valueRaw=03 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0030 duration=6 index=3 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0

## Vanilla Max-Group Sprite 597 Front
### vanilla 597 front NMCR
len=140 groups=6 pad=0xbeef multiOff=0x0014 hierOff=0x0044 stringOff=0x0000 extOff=0x0000
group[0] raw=01 00 01 00 00 00 00 00 nodes=1 cellAnim=1 hierarchyOffset=0x0000
  node[0] raw=00 00 00 00 00 00 20 00 seq=0 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
group[1] raw=01 00 01 00 08 00 00 00 nodes=1 cellAnim=1 hierarchyOffset=0x0008
  node[0] raw=01 00 00 00 00 00 20 00 seq=1 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
group[2] raw=01 00 01 00 10 00 00 00 nodes=1 cellAnim=1 hierarchyOffset=0x0010
  node[0] raw=02 00 00 00 00 00 20 00 seq=2 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
group[3] raw=01 00 01 00 18 00 00 00 nodes=1 cellAnim=1 hierarchyOffset=0x0018
  node[0] raw=03 00 00 00 00 00 20 00 seq=3 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
group[4] raw=01 00 01 00 20 00 00 00 nodes=1 cellAnim=1 hierarchyOffset=0x0020
  node[0] raw=04 00 00 00 00 00 20 00 seq=4 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
group[5] raw=01 00 01 00 28 00 00 00 nodes=1 cellAnim=1 hierarchyOffset=0x0028
  node[0] raw=05 00 00 00 00 00 20 00 seq=5 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
### vanilla 597 front NANR
len=1137 seq=7 totalFrames=58 seqOff=0x0018 frameOff=0x0088 valueOff=0x0258
seq[0] raw=06 00 00 00 00 00 01 00 02 00 00 00 00 00 00 00 frames=6 start=0 motion=0 target=1 mode=2 frameDataOff=0x0000
  frame[0] frameRaw=00 00 00 00 07 00 ef be valueRaw=00 00 valueOff=0x0000 duration=7 index=0
  frame[1] frameRaw=02 00 00 00 07 00 ef be valueRaw=01 00 valueOff=0x0002 duration=7 index=1
  frame[2] frameRaw=04 00 00 00 07 00 ef be valueRaw=02 00 valueOff=0x0004 duration=7 index=2
  frame[3] frameRaw=06 00 00 00 07 00 ef be valueRaw=03 00 valueOff=0x0006 duration=7 index=3
  frame[4] frameRaw=08 00 00 00 07 00 ef be valueRaw=04 00 valueOff=0x0008 duration=7 index=4
  frame[5] frameRaw=0a 00 00 00 07 00 ef be valueRaw=05 00 valueOff=0x000a duration=7 index=5
seq[1] raw=06 00 00 00 00 00 01 00 02 00 00 00 30 00 00 00 frames=6 start=0 motion=0 target=1 mode=2 frameDataOff=0x0030
  frame[0] frameRaw=00 00 00 00 05 00 ef be valueRaw=00 00 valueOff=0x0000 duration=5 index=0
  frame[1] frameRaw=02 00 00 00 05 00 ef be valueRaw=01 00 valueOff=0x0002 duration=5 index=1
  frame[2] frameRaw=04 00 00 00 05 00 ef be valueRaw=02 00 valueOff=0x0004 duration=5 index=2
  frame[3] frameRaw=06 00 00 00 05 00 ef be valueRaw=03 00 valueOff=0x0006 duration=5 index=3
  frame[4] frameRaw=08 00 00 00 05 00 ef be valueRaw=04 00 valueOff=0x0008 duration=5 index=4
  frame[5] frameRaw=0a 00 00 00 05 00 ef be valueRaw=05 00 valueOff=0x000a duration=5 index=5
seq[2] raw=06 00 00 00 00 00 01 00 02 00 00 00 60 00 00 00 frames=6 start=0 motion=0 target=1 mode=2 frameDataOff=0x0060
  frame[0] frameRaw=00 00 00 00 03 00 ef be valueRaw=00 00 valueOff=0x0000 duration=3 index=0
  frame[1] frameRaw=02 00 00 00 03 00 ef be valueRaw=01 00 valueOff=0x0002 duration=3 index=1
  frame[2] frameRaw=04 00 00 00 03 00 ef be valueRaw=02 00 valueOff=0x0004 duration=3 index=2
  frame[3] frameRaw=06 00 00 00 03 00 ef be valueRaw=03 00 valueOff=0x0006 duration=3 index=3
  frame[4] frameRaw=08 00 00 00 03 00 ef be valueRaw=04 00 valueOff=0x0008 duration=3 index=4
  frame[5] frameRaw=0a 00 00 00 03 00 ef be valueRaw=05 00 valueOff=0x000a duration=3 index=5
seq[3] raw=06 00 00 00 00 00 01 00 02 00 00 00 90 00 00 00 frames=6 start=0 motion=0 target=1 mode=2 frameDataOff=0x0090
  frame[0] frameRaw=00 00 00 00 01 00 ef be valueRaw=00 00 valueOff=0x0000 duration=1 index=0
  frame[1] frameRaw=02 00 00 00 01 00 ef be valueRaw=01 00 valueOff=0x0002 duration=1 index=1
  frame[2] frameRaw=04 00 00 00 01 00 ef be valueRaw=02 00 valueOff=0x0004 duration=1 index=2
  frame[3] frameRaw=06 00 00 00 01 00 ef be valueRaw=03 00 valueOff=0x0006 duration=1 index=3
  frame[4] frameRaw=08 00 00 00 01 00 ef be valueRaw=04 00 valueOff=0x0008 duration=1 index=4
  frame[5] frameRaw=0a 00 00 00 01 00 ef be valueRaw=05 00 valueOff=0x000a duration=1 index=5
seq[4] raw=18 00 00 00 01 00 01 00 02 00 00 00 c0 00 00 00 frames=24 start=0 motion=1 target=1 mode=2 frameDataOff=0x00c0
  frame[0] frameRaw=0c 00 00 00 01 00 ef be valueRaw=00 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x000c duration=1 index=0 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[1] frameRaw=1c 00 00 00 01 00 ef be valueRaw=01 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x001c duration=1 index=1 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[2] frameRaw=2c 00 00 00 01 00 ef be valueRaw=02 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x002c duration=1 index=2 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[3] frameRaw=3c 00 00 00 01 00 ef be valueRaw=03 00 00 00 00 10 00 00 66 0e 00 00 00 00 00 00 valueOff=0x003c duration=1 index=3 rot=0x0000 sx=0x00001000 sy=0x00000e66 px=0 py=0
  frame[4] frameRaw=4c 00 00 00 01 00 ef be valueRaw=04 00 00 00 00 10 00 00 66 0e 00 00 00 00 00 00 valueOff=0x004c duration=1 index=4 rot=0x0000 sx=0x00001000 sy=0x00000e66 px=0 py=0
  frame[5] frameRaw=5c 00 00 00 01 00 ef be valueRaw=05 00 00 00 00 10 00 00 66 0e 00 00 00 00 00 00 valueOff=0x005c duration=1 index=5 rot=0x0000 sx=0x00001000 sy=0x00000e66 px=0 py=0
  frame[6] frameRaw=6c 00 00 00 01 00 ef be valueRaw=00 00 00 00 00 10 00 00 00 10 00 00 00 00 ff ff valueOff=0x006c duration=1 index=0 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=-1
  frame[7] frameRaw=7c 00 00 00 01 00 ef be valueRaw=01 00 00 00 00 10 00 00 00 10 00 00 00 00 fe ff valueOff=0x007c duration=1 index=1 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=-2
  frame[8] frameRaw=8c 00 00 00 01 00 ef be valueRaw=02 00 00 00 00 10 00 00 00 10 00 00 00 00 fd ff valueOff=0x008c duration=1 index=2 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=-3
  frame[9] frameRaw=9c 00 00 00 01 00 ef be valueRaw=03 00 00 00 00 10 00 00 00 10 00 00 00 00 fc ff valueOff=0x009c duration=1 index=3 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=-4
  ... 14 more frames
seq[5] raw=09 00 00 00 00 00 01 00 02 00 00 00 80 01 00 00 frames=9 start=0 motion=0 target=1 mode=2 frameDataOff=0x0180
  frame[0] frameRaw=00 00 00 00 1e 00 ef be valueRaw=00 00 valueOff=0x0000 duration=30 index=0
  frame[1] frameRaw=8c 01 00 00 08 00 ef be valueRaw=06 00 valueOff=0x018c duration=8 index=6
  frame[2] frameRaw=00 00 00 00 08 00 ef be valueRaw=00 00 valueOff=0x0000 duration=8 index=0
  frame[3] frameRaw=00 00 00 00 14 00 ef be valueRaw=00 00 valueOff=0x0000 duration=20 index=0
  frame[4] frameRaw=8c 01 00 00 08 00 ef be valueRaw=06 00 valueOff=0x018c duration=8 index=6
  frame[5] frameRaw=00 00 00 00 08 00 ef be valueRaw=00 00 valueOff=0x0000 duration=8 index=0
  frame[6] frameRaw=8c 01 00 00 08 00 ef be valueRaw=06 00 valueOff=0x018c duration=8 index=6
  frame[7] frameRaw=00 00 00 00 08 00 ef be valueRaw=00 00 valueOff=0x0000 duration=8 index=0
  frame[8] frameRaw=00 00 00 00 1e 00 ef be valueRaw=00 00 valueOff=0x0000 duration=30 index=0
seq[6] raw=01 00 00 00 00 00 01 00 02 00 00 00 c8 01 00 00 frames=1 start=0 motion=0 target=1 mode=2 frameDataOff=0x01c8
  frame[0] frameRaw=00 00 00 00 04 00 ef be valueRaw=00 00 valueOff=0x0000 duration=4 index=0
### vanilla 597 front NMAR
len=275 seq=1 totalFrames=22 seqOff=0x0018 frameOff=0x0028 valueOff=0x00d8
seq[0] raw=16 00 00 00 00 00 02 00 02 00 00 00 00 00 00 00 frames=22 start=0 motion=0 target=2 mode=2 frameDataOff=0x0000
  frame[0] frameRaw=00 00 00 00 80 00 ef be valueRaw=05 00 valueOff=0x0000 duration=128 index=5
  frame[1] frameRaw=00 00 00 00 80 00 ef be valueRaw=05 00 valueOff=0x0000 duration=128 index=5
  frame[2] frameRaw=02 00 00 00 2a 00 ef be valueRaw=00 00 valueOff=0x0002 duration=42 index=0
  frame[3] frameRaw=02 00 00 00 2a 00 ef be valueRaw=00 00 valueOff=0x0002 duration=42 index=0
  frame[4] frameRaw=04 00 00 00 1e 00 ef be valueRaw=01 00 valueOff=0x0004 duration=30 index=1
  frame[5] frameRaw=06 00 00 00 12 00 ef be valueRaw=02 00 valueOff=0x0006 duration=18 index=2
  frame[6] frameRaw=08 00 00 00 06 00 ef be valueRaw=03 00 valueOff=0x0008 duration=6 index=3
  frame[7] frameRaw=08 00 00 00 06 00 ef be valueRaw=03 00 valueOff=0x0008 duration=6 index=3
  frame[8] frameRaw=08 00 00 00 06 00 ef be valueRaw=03 00 valueOff=0x0008 duration=6 index=3
  frame[9] frameRaw=08 00 00 00 06 00 ef be valueRaw=03 00 valueOff=0x0008 duration=6 index=3
  ... 12 more frames

## Vanilla Max-Group Sprite 597 Back
### vanilla 597 back NMCR
len=140 groups=6 pad=0xbeef multiOff=0x0014 hierOff=0x0044 stringOff=0x0000 extOff=0x0000
group[0] raw=01 00 01 00 00 00 00 00 nodes=1 cellAnim=1 hierarchyOffset=0x0000
  node[0] raw=00 00 00 00 00 00 21 00 seq=0 x=0 y=0 attr=0x0021 cellAnim=0 visible=true
group[1] raw=01 00 01 00 08 00 00 00 nodes=1 cellAnim=1 hierarchyOffset=0x0008
  node[0] raw=01 00 00 00 00 00 20 00 seq=1 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
group[2] raw=01 00 01 00 10 00 00 00 nodes=1 cellAnim=1 hierarchyOffset=0x0010
  node[0] raw=02 00 00 00 00 00 20 00 seq=2 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
group[3] raw=01 00 01 00 18 00 00 00 nodes=1 cellAnim=1 hierarchyOffset=0x0018
  node[0] raw=03 00 00 00 00 00 20 00 seq=3 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
group[4] raw=01 00 01 00 20 00 00 00 nodes=1 cellAnim=1 hierarchyOffset=0x0020
  node[0] raw=04 00 00 00 00 00 20 00 seq=4 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
group[5] raw=01 00 01 00 28 00 00 00 nodes=1 cellAnim=1 hierarchyOffset=0x0028
  node[0] raw=05 00 00 00 00 00 20 00 seq=5 x=0 y=0 attr=0x0020 cellAnim=0 visible=true
### vanilla 597 back NANR
len=1106 seq=6 totalFrames=65 seqOff=0x0018 frameOff=0x0078 valueOff=0x0280
seq[0] raw=08 00 00 00 00 00 01 00 02 00 00 00 00 00 00 00 frames=8 start=0 motion=0 target=1 mode=2 frameDataOff=0x0000
  frame[0] frameRaw=00 00 00 00 01 00 ef be valueRaw=00 00 valueOff=0x0000 duration=1 index=0
  frame[1] frameRaw=02 00 00 00 01 00 ef be valueRaw=07 00 valueOff=0x0002 duration=1 index=7
  frame[2] frameRaw=04 00 00 00 01 00 ef be valueRaw=06 00 valueOff=0x0004 duration=1 index=6
  frame[3] frameRaw=06 00 00 00 01 00 ef be valueRaw=05 00 valueOff=0x0006 duration=1 index=5
  frame[4] frameRaw=08 00 00 00 01 00 ef be valueRaw=04 00 valueOff=0x0008 duration=1 index=4
  frame[5] frameRaw=0a 00 00 00 01 00 ef be valueRaw=03 00 valueOff=0x000a duration=1 index=3
  frame[6] frameRaw=0c 00 00 00 01 00 ef be valueRaw=02 00 valueOff=0x000c duration=1 index=2
  frame[7] frameRaw=0e 00 00 00 01 00 ef be valueRaw=01 00 valueOff=0x000e duration=1 index=1
seq[1] raw=08 00 00 00 00 00 01 00 02 00 00 00 40 00 00 00 frames=8 start=0 motion=0 target=1 mode=2 frameDataOff=0x0040
  frame[0] frameRaw=00 00 00 00 02 00 ef be valueRaw=00 00 valueOff=0x0000 duration=2 index=0
  frame[1] frameRaw=02 00 00 00 02 00 ef be valueRaw=07 00 valueOff=0x0002 duration=2 index=7
  frame[2] frameRaw=04 00 00 00 02 00 ef be valueRaw=06 00 valueOff=0x0004 duration=2 index=6
  frame[3] frameRaw=06 00 00 00 02 00 ef be valueRaw=05 00 valueOff=0x0006 duration=2 index=5
  frame[4] frameRaw=08 00 00 00 02 00 ef be valueRaw=04 00 valueOff=0x0008 duration=2 index=4
  frame[5] frameRaw=0a 00 00 00 02 00 ef be valueRaw=03 00 valueOff=0x000a duration=2 index=3
  frame[6] frameRaw=0c 00 00 00 02 00 ef be valueRaw=02 00 valueOff=0x000c duration=2 index=2
  frame[7] frameRaw=0e 00 00 00 02 00 ef be valueRaw=01 00 valueOff=0x000e duration=2 index=1
seq[2] raw=08 00 00 00 00 00 01 00 02 00 00 00 80 00 00 00 frames=8 start=0 motion=0 target=1 mode=2 frameDataOff=0x0080
  frame[0] frameRaw=00 00 00 00 04 00 ef be valueRaw=00 00 valueOff=0x0000 duration=4 index=0
  frame[1] frameRaw=02 00 00 00 04 00 ef be valueRaw=07 00 valueOff=0x0002 duration=4 index=7
  frame[2] frameRaw=04 00 00 00 04 00 ef be valueRaw=06 00 valueOff=0x0004 duration=4 index=6
  frame[3] frameRaw=06 00 00 00 04 00 ef be valueRaw=05 00 valueOff=0x0006 duration=4 index=5
  frame[4] frameRaw=08 00 00 00 04 00 ef be valueRaw=04 00 valueOff=0x0008 duration=4 index=4
  frame[5] frameRaw=0a 00 00 00 04 00 ef be valueRaw=03 00 valueOff=0x000a duration=4 index=3
  frame[6] frameRaw=0c 00 00 00 04 00 ef be valueRaw=02 00 valueOff=0x000c duration=4 index=2
  frame[7] frameRaw=0e 00 00 00 04 00 ef be valueRaw=01 00 valueOff=0x000e duration=4 index=1
seq[3] raw=08 00 00 00 00 00 01 00 02 00 00 00 c0 00 00 00 frames=8 start=0 motion=0 target=1 mode=2 frameDataOff=0x00c0
  frame[0] frameRaw=00 00 00 00 05 00 ef be valueRaw=00 00 valueOff=0x0000 duration=5 index=0
  frame[1] frameRaw=02 00 00 00 05 00 ef be valueRaw=07 00 valueOff=0x0002 duration=5 index=7
  frame[2] frameRaw=04 00 00 00 05 00 ef be valueRaw=06 00 valueOff=0x0004 duration=5 index=6
  frame[3] frameRaw=06 00 00 00 05 00 ef be valueRaw=05 00 valueOff=0x0006 duration=5 index=5
  frame[4] frameRaw=08 00 00 00 05 00 ef be valueRaw=04 00 valueOff=0x0008 duration=5 index=4
  frame[5] frameRaw=0a 00 00 00 05 00 ef be valueRaw=03 00 valueOff=0x000a duration=5 index=3
  frame[6] frameRaw=0c 00 00 00 05 00 ef be valueRaw=02 00 valueOff=0x000c duration=5 index=2
  frame[7] frameRaw=0e 00 00 00 05 00 ef be valueRaw=01 00 valueOff=0x000e duration=5 index=1
seq[4] raw=18 00 00 00 01 00 01 00 02 00 00 00 00 01 00 00 frames=24 start=0 motion=1 target=1 mode=2 frameDataOff=0x0100
  frame[0] frameRaw=10 00 00 00 01 00 ef be valueRaw=00 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0010 duration=1 index=0 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[1] frameRaw=20 00 00 00 01 00 ef be valueRaw=07 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0020 duration=1 index=7 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[2] frameRaw=30 00 00 00 01 00 ef be valueRaw=06 00 00 00 00 10 00 00 00 10 00 00 00 00 00 00 valueOff=0x0030 duration=1 index=6 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=0
  frame[3] frameRaw=40 00 00 00 01 00 ef be valueRaw=05 00 00 00 00 10 00 00 66 0e 00 00 00 00 00 00 valueOff=0x0040 duration=1 index=5 rot=0x0000 sx=0x00001000 sy=0x00000e66 px=0 py=0
  frame[4] frameRaw=50 00 00 00 01 00 ef be valueRaw=04 00 00 00 00 10 00 00 66 0e 00 00 00 00 00 00 valueOff=0x0050 duration=1 index=4 rot=0x0000 sx=0x00001000 sy=0x00000e66 px=0 py=0
  frame[5] frameRaw=60 00 00 00 01 00 ef be valueRaw=03 00 00 00 00 10 00 00 66 0e 00 00 00 00 00 00 valueOff=0x0060 duration=1 index=3 rot=0x0000 sx=0x00001000 sy=0x00000e66 px=0 py=0
  frame[6] frameRaw=70 00 00 00 01 00 ef be valueRaw=02 00 00 00 00 10 00 00 00 10 00 00 00 00 ff ff valueOff=0x0070 duration=1 index=2 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=-1
  frame[7] frameRaw=80 00 00 00 01 00 ef be valueRaw=01 00 00 00 00 10 00 00 00 10 00 00 00 00 fe ff valueOff=0x0080 duration=1 index=1 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=-2
  frame[8] frameRaw=90 00 00 00 01 00 ef be valueRaw=00 00 00 00 00 10 00 00 00 10 00 00 00 00 fd ff valueOff=0x0090 duration=1 index=0 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=-3
  frame[9] frameRaw=a0 00 00 00 01 00 ef be valueRaw=07 00 00 00 00 10 00 00 00 10 00 00 00 00 fc ff valueOff=0x00a0 duration=1 index=7 rot=0x0000 sx=0x00001000 sy=0x00001000 px=0 py=-4
  ... 14 more frames
seq[5] raw=09 00 00 00 00 00 01 00 02 00 00 00 c0 01 00 00 frames=9 start=0 motion=0 target=1 mode=2 frameDataOff=0x01c0
  frame[0] frameRaw=00 00 00 00 1e 00 ef be valueRaw=00 00 valueOff=0x0000 duration=30 index=0
  frame[1] frameRaw=60 01 00 00 08 00 ef be valueRaw=08 00 valueOff=0x0160 duration=8 index=8
  frame[2] frameRaw=00 00 00 00 08 00 ef be valueRaw=00 00 valueOff=0x0000 duration=8 index=0
  frame[3] frameRaw=00 00 00 00 14 00 ef be valueRaw=00 00 valueOff=0x0000 duration=20 index=0
  frame[4] frameRaw=60 01 00 00 08 00 ef be valueRaw=08 00 valueOff=0x0160 duration=8 index=8
  frame[5] frameRaw=00 00 00 00 08 00 ef be valueRaw=00 00 valueOff=0x0000 duration=8 index=0
  frame[6] frameRaw=60 01 00 00 08 00 ef be valueRaw=08 00 valueOff=0x0160 duration=8 index=8
  frame[7] frameRaw=00 00 00 00 08 00 ef be valueRaw=00 00 valueOff=0x0000 duration=8 index=0
  frame[8] frameRaw=00 00 00 00 1e 00 ef be valueRaw=00 00 valueOff=0x0000 duration=30 index=0
### vanilla 597 back NMAR
len=267 seq=1 totalFrames=21 seqOff=0x0018 frameOff=0x0028 valueOff=0x00d0
seq[0] raw=15 00 00 00 00 00 02 00 02 00 00 00 00 00 00 00 frames=21 start=0 motion=0 target=2 mode=2 frameDataOff=0x0000
  frame[0] frameRaw=00 00 00 00 80 00 ef be valueRaw=05 00 valueOff=0x0000 duration=128 index=5
  frame[1] frameRaw=00 00 00 00 80 00 ef be valueRaw=05 00 valueOff=0x0000 duration=128 index=5
  frame[2] frameRaw=02 00 00 00 28 00 ef be valueRaw=03 00 valueOff=0x0002 duration=40 index=3
  frame[3] frameRaw=02 00 00 00 28 00 ef be valueRaw=03 00 valueOff=0x0002 duration=40 index=3
  frame[4] frameRaw=04 00 00 00 20 00 ef be valueRaw=02 00 valueOff=0x0004 duration=32 index=2
  frame[5] frameRaw=06 00 00 00 10 00 ef be valueRaw=01 00 valueOff=0x0006 duration=16 index=1
  frame[6] frameRaw=08 00 00 00 08 00 ef be valueRaw=00 00 valueOff=0x0008 duration=8 index=0
  frame[7] frameRaw=08 00 00 00 08 00 ef be valueRaw=00 00 valueOff=0x0008 duration=8 index=0
  frame[8] frameRaw=08 00 00 00 08 00 ef be valueRaw=00 00 valueOff=0x0008 duration=8 index=0
  frame[9] frameRaw=0a 00 00 00 18 00 ef be valueRaw=04 00 valueOff=0x000a duration=24 index=4
  ... 11 more frames

## Byte-Level Finding
- Vanilla multi-group NMCR is real: sprite 597 uses 6 groups and NMAR indexes 0..5.
- The reconstructed crash variant differs structurally from vanilla in how NMCR nodes point at cell-animation sequence numbers: vanilla 597 groups are one-node groups over a small matching NANR sequence set, while grouped macro creates many nodes per group that reference static chunk sequences.
- If the engine allocates or advances per-cell animation controllers from each group record, this grouped macro layout combines high group switching with many node/sequence references per group. The safe macro layout keeps two duplicated groups and puts the time-varying swaps in cell NANR instead.

import { describe, expect, it } from "vitest";
import type { MoveAnimationTimelineEvent } from "../pokeweb/moveAnimationPreviewModel";
import {
  extractMoveAnimationSoundCues,
  moveAnimationSoundCuesCrossed,
  moveAnimationSoundGain,
  moveAnimationSoundPitchRate,
} from "../ui/moveAnimationTimelineAudio";

function timelineEvent(command: string, frame: number, params: number[], id = `${command}:${frame}`): MoveAnimationTimelineEvent {
  return {
    id,
    frame,
    label: "test",
    command,
    params,
    status: "marker",
    message: command,
  };
}

describe("move animation timeline audio", () => {
  it("extracts and orders PlaySound cues from the simulated timeline", () => {
    const cues = extractMoveAnimationSoundCues([
      timelineEvent("PlaySound", 18, [1440, 2, 1, 0, -400, 110], "later"),
      timelineEvent("Wait", 4, [4]),
      timelineEvent("PlaySound", 3, [1434, 1, 0, 0, 200, 120], "earlier"),
    ]);

    expect(cues).toEqual([
      { id: "earlier", frame: 3, sequenceId: 1434, player: 1, pan: 0, pitch: 200, volume: 120 },
      { id: "later", frame: 18, sequenceId: 1440, player: 2, pan: 1, pitch: -400, volume: 110 },
    ]);
  });

  it("selects only cues crossed during forward playback", () => {
    const cues = extractMoveAnimationSoundCues([
      timelineEvent("PlaySound", 0, [1]),
      timelineEvent("PlaySound", 5, [2]),
      timelineEvent("PlaySound", 10, [3]),
    ]);

    expect(moveAnimationSoundCuesCrossed(cues, 0, 5).map((cue) => cue.sequenceId)).toEqual([2]);
    expect(moveAnimationSoundCuesCrossed(cues, 5, 10).map((cue) => cue.sequenceId)).toEqual([3]);
    expect(moveAnimationSoundCuesCrossed(cues, 10, 2)).toEqual([]);
  });

  it("converts script volume and cents to Web Audio values", () => {
    expect(moveAnimationSoundGain(127)).toBe(1);
    expect(moveAnimationSoundGain(63.5)).toBe(0.5);
    expect(moveAnimationSoundGain(-20)).toBe(0);
    expect(moveAnimationSoundGain(200)).toBe(1);
    expect(moveAnimationSoundPitchRate(0)).toBe(1);
    expect(moveAnimationSoundPitchRate(1200)).toBe(2);
    expect(moveAnimationSoundPitchRate(-1200)).toBe(0.5);
  });
});

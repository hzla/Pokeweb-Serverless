export type TestBattleEmulatorPayload = {
  romName: string;
  saveName: string;
  trainerId: number;
  testLabel?: string;
  romBytes: Uint8Array;
  saveBytes: Uint8Array;
};

type ReadyMessage = {
  type: "pokeweb-test-battle-ready";
  sessionId: string;
};

const READY_TIMEOUT_MS = 15000;
const TEST_BATTLE_EMULATOR_VERSION = "test-battle-desmond-2026-05-21-1535";

export function openTestBattleEmulator(): { launch: (payload: TestBattleEmulatorPayload) => Promise<void>; close: () => void } {
  const sessionId = createSessionId();
  const url = new URL("test-battle-emulator.html", window.location.href);
  url.searchParams.set("pokeweb", TEST_BATTLE_EMULATOR_VERSION);
  url.hash = `session=${encodeURIComponent(sessionId)}`;

  const emulatorWindow = window.open(url.href, "_blank");
  if (!emulatorWindow) throw new Error("Could not open the Test Battle emulator tab. Please allow pop-ups for this site and try again.");

  const ready = waitForReady(emulatorWindow, sessionId);
  return {
    launch: async (payload) => {
      await ready;
      const romBuffer = transferableBuffer(payload.romBytes);
      const saveBuffer = transferableBuffer(payload.saveBytes);
      emulatorWindow.postMessage(
        {
          type: "pokeweb-test-battle-load",
          sessionId,
          romName: payload.romName,
          saveName: payload.saveName,
          trainerId: payload.trainerId,
          testLabel: payload.testLabel,
          romBuffer,
          saveBuffer,
        },
        window.location.origin,
        [romBuffer, saveBuffer],
      );
    },
    close: () => emulatorWindow.close(),
  };
}

function waitForReady(emulatorWindow: Window, sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("The Test Battle emulator tab did not initialize."));
    }, READY_TIMEOUT_MS);

    const onMessage = (event: MessageEvent<ReadyMessage>) => {
      if (event.source !== emulatorWindow) return;
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "pokeweb-test-battle-ready" || event.data.sessionId !== sessionId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve();
    };

    window.addEventListener("message", onMessage);
  });
}

function transferableBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer as ArrayBuffer;
  if (bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength) return buffer;
  return buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function createSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

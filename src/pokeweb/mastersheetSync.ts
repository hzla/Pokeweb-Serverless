/**
 * Keeps the editor tab and the Mastersheet Viewer agreeing on the sheet. Both hold the project in memory; when
 * either saves a new sheet it says so here, and the other takes it. Without this, the editor's next save of the
 * whole project would put back the sheet it loaded before the viewer's edits.
 */

const CHANNEL_NAME = "pokeweb-mastersheet";
const TAB_ID = Math.random().toString(36).slice(2);

type MastersheetSyncMessage = { kind: "mastersheet"; markdown: string; from: string };

let channel: BroadcastChannel | undefined | null;

function openChannel(): BroadcastChannel | undefined {
  if (channel === undefined) {
    try {
      channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL_NAME) : null;
    } catch {
      channel = null;
    }
  }
  return channel ?? undefined;
}

export function announceMastersheet(markdown: string): void {
  openChannel()?.postMessage({ kind: "mastersheet", markdown, from: TAB_ID } satisfies MastersheetSyncMessage);
}

/** Calls `handle` with each sheet another tab saves. Returns a function that stops listening. */
export function listenForMastersheet(handle: (markdown: string) => void): () => void {
  const target = openChannel();
  if (!target) return () => undefined;
  const listener = (event: MessageEvent) => {
    const message = event.data as Partial<MastersheetSyncMessage> | null;
    if (message?.kind === "mastersheet" && message.from !== TAB_ID && typeof message.markdown === "string") handle(message.markdown);
  };
  target.addEventListener("message", listener);
  return () => target.removeEventListener("message", listener);
}

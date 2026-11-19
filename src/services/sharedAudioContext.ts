export type AudioContextConstructor = new () => AudioContext;

let sharedAudioContext: AudioContext | null = null;
let sharedAudioContextCtor: AudioContextConstructor | null = null;

export function getSharedAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const win = window as Window & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  if (typeof AudioContext !== "undefined") return AudioContext;
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

export function getOrCreateSharedAudioContext(): AudioContext | null {
  const Ctor = getSharedAudioContextConstructor();
  if (!Ctor) {
    sharedAudioContext = null;
    sharedAudioContextCtor = null;
    return null;
  }
  if (
    sharedAudioContext &&
    sharedAudioContextCtor === Ctor &&
    sharedAudioContext.state !== "closed"
  ) {
    return sharedAudioContext;
  }
  sharedAudioContext = new Ctor();
  sharedAudioContextCtor = Ctor;
  return sharedAudioContext;
}

export async function resumeSharedAudioContext(ctx: AudioContext): Promise<void> {
  if (ctx.state === "suspended") {
    await ctx.resume().catch(() => undefined);
  }
}

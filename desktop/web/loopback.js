// The PC's own sound for the waves: the main process answers getDisplayMedia with
// system audio loopback; the screen picture that comes with it is stopped at once.
export async function loopback() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 16, height: 16, frameRate: 1 } });
  for (const t of stream.getVideoTracks()) {
    t.stop();
    stream.removeTrack(t);
  }
  if (!stream.getAudioTracks().length) throw new Error('нет звуковой дорожки');
  return stream;
}

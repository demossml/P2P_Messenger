export async function setVideoBitrate(sender: RTCRtpSender, kbps: number): Promise<void> {
  const safeKbps = Math.max(1, Math.floor(kbps));
  const params = sender.getParameters();
  const encodings = params.encodings ?? [{}];
  const firstEncoding = encodings[0] ?? {};

  firstEncoding.maxBitrate = safeKbps * 1000;
  params.encodings = [firstEncoding, ...encodings.slice(1)];

  await sender.setParameters(params);
}

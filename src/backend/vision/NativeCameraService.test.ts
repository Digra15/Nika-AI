import { describe, expect, it } from "vitest";
import { JpegStreamParser, parseDirectShowVideoDevices } from "./NativeCameraService.js";

describe("NativeCameraService helpers", () => {
  it("parses DirectShow video devices from ffmpeg stderr", () => {
    const sample = `
[dshow @ 000001] "USB2.0 HD UVC WebCam" (video)
[dshow @ 000001]   Alternative name "@device_pnp_..."
[dshow @ 000001] "Microphone (USB Audio Device)" (audio)
[dshow @ 000001] "OBS Virtual Camera" (video)
`;
    expect(parseDirectShowVideoDevices(sample)).toEqual([
      "USB2.0 HD UVC WebCam",
      "OBS Virtual Camera"
    ]);
  });

  it("extracts complete JPEG frames across split chunks", () => {
    const parser = new JpegStreamParser();
    const frames: Buffer[] = [];
    const f1 = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
    const f2 = Buffer.from([0xff, 0xd8, 0x03, 0x04, 0x05, 0xff, 0xd9]);

    parser.push(Buffer.concat([Buffer.from([0x00, 0x11]), f1.subarray(0, 3)]), (b) => frames.push(b));
    expect(frames).toHaveLength(0);

    parser.push(Buffer.concat([f1.subarray(3), f2]), (b) => frames.push(b));
    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual(f1);
    expect(frames[1]).toEqual(f2);
  });
});

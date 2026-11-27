import { describe, expect, it } from "vitest";
import { humanizeForSpeech } from "./ResponseHumanizer.js";

describe("ResponseHumanizer", () => {
  it("strips markdown, URLs, emojis, and stage directions", () => {
    const raw =
      "**Halo!** 😊 *tersenyum* Cek [info cuaca](https://example.com/cuaca) atau https://bmkg.go.id — suhu naik 10% & cerah.";
    const clean = humanizeForSpeech(raw);
    expect(clean).toBe("Halo! Cek info cuaca atau, suhu naik 10 persen dan cerah.");
  });

  it("flattens numbered lists and bullets into smooth speech", () => {
    const raw = "1. Minum air putih\n2. Istirahat cukup\n- Jangan begadang";
    const clean = humanizeForSpeech(raw);
    expect(clean).toBe("Minum air putih Istirahat cukup Jangan begadang");
  });
});

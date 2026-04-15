import { describe, it, expect } from "vitest";
import { parseAerospaceOutput } from "../../server/services/discover.js";

describe("parseAerospaceOutput", () => {
  it("parses a standard row with bundle-id", () => {
    const out =
      "123|com.apple.Safari|Safari|main|Start Page\n";
    const apps = parseAerospaceOutput(out);
    expect(apps).toEqual({
      "com.apple.Safari": {
        name: "Safari",
        source: "discovered",
        defaultStartup: "open -a 'Safari'",
      },
    });
  });

  it("synthesizes a key when bundle-id is empty (e.g. Google Meet PWA)", () => {
    const out = "15277||Google Meet|main|Google Meet\n";
    const apps = parseAerospaceOutput(out);
    expect(apps).toHaveProperty("app-name:Google Meet");
    expect(apps["app-name:Google Meet"].name).toBe("Google Meet");
    expect(apps["app-name:Google Meet"].source).toBe("discovered");
    expect(apps["app-name:Google Meet"].defaultStartup).toBe(
      "open -a 'Google Meet'",
    );
  });

  it("still skips rows with empty app-name", () => {
    const out = "42|com.example.foo||main|\n";
    const apps = parseAerospaceOutput(out);
    expect(apps).toEqual({});
  });

  it("keeps the first occurrence of a duplicate bundle-id", () => {
    const out =
      "1|com.apple.Safari|Safari|ws1|Page A\n" +
      "2|com.apple.Safari|Safari|ws2|Page B\n";
    const apps = parseAerospaceOutput(out);
    expect(Object.keys(apps)).toEqual(["com.apple.Safari"]);
    expect(apps["com.apple.Safari"].name).toBe("Safari");
  });

  it("handles surrounding whitespace and blank lines", () => {
    const out =
      "\n" +
      " 123 | com.apple.Safari | Safari | main | Start \n" +
      "\n";
    const apps = parseAerospaceOutput(out);
    expect(apps).toHaveProperty("com.apple.Safari");
    expect(apps["com.apple.Safari"].name).toBe("Safari");
  });
});

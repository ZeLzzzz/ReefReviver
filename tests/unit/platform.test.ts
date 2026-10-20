import { describe, expect, it } from "vitest";
import { getWebGL2Context, isPhoneOrTablet } from "../../src/platform";

const UA = {
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  androidPhone:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  iPhone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iPad: "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
};

describe("isPhoneOrTablet (REQ-001 AC-7)", () => {
  it.each([
    ["Android phone", UA.androidPhone, 5],
    ["Android tablet", UA.androidTablet, 10],
    ["iPhone", UA.iPhone, 5],
    ["iPad", UA.iPad, 5],
    ["iPadOS asking for the desktop site", UA.macSafari, 5],
  ])("blocks %s", (_name, userAgent, maxTouchPoints) => {
    expect(isPhoneOrTablet({ userAgent, maxTouchPoints })).toBe(true);
  });

  it.each([
    ["Windows desktop", UA.windowsChrome, 0],
    ["Windows touchscreen laptop", UA.windowsChrome, 10],
    ["Linux desktop", UA.linuxFirefox, 0],
    ["Mac", UA.macSafari, 0],
  ])("allows %s", (_name, userAgent, maxTouchPoints) => {
    expect(isPhoneOrTablet({ userAgent, maxTouchPoints })).toBe(false);
  });

  it("trusts the browser's own mobile hint", () => {
    expect(isPhoneOrTablet({ userAgent: UA.windowsChrome, maxTouchPoints: 0, mobileHint: true })).toBe(true);
  });
});

describe("getWebGL2Context (REQ-001 AC-8)", () => {
  const canvasReturning = (getContext: () => unknown) => ({ getContext }) as unknown as HTMLCanvasElement;

  it("returns null when the browser has no WebGL 2", () => {
    expect(getWebGL2Context(canvasReturning(() => null))).toBeNull();
  });

  it("returns null when asking for WebGL 2 throws", () => {
    expect(
      getWebGL2Context(
        canvasReturning(() => {
          throw new Error("context lost");
        }),
      ),
    ).toBeNull();
  });

  it("returns the context when there is one", () => {
    const context = {};
    expect(getWebGL2Context(canvasReturning(() => context))).toBe(context);
  });
});

export interface DeviceInfo {
  userAgent: string;
  maxTouchPoints: number;
  /** `navigator.userAgentData.mobile`, where the browser provides it. */
  mobileHint?: boolean;
}

export function readDeviceInfo(nav: Navigator): DeviceInfo {
  const uaData = (nav as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  return { userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints, mobileHint: uaData?.mobile };
}

/**
 * Phones and tablets get a "play on a computer" message (REQ-001 AC-7). Touchscreen laptops are
 * not blocked: only the browser's own mobile signals count, never the presence of a touchscreen.
 */
export function isPhoneOrTablet(device: DeviceInfo): boolean {
  if (device.mobileHint) return true;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(device.userAgent)) return true;
  // iPadOS asks for the desktop site and reports itself as a Mac, but Macs have no touchscreen.
  return /Macintosh/.test(device.userAgent) && device.maxTouchPoints > 1;
}

/** A WebGL 2 context for the renderer, or null when the browser cannot provide one (REQ-001 AC-8). */
export function getWebGL2Context(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  try {
    return canvas.getContext("webgl2", { antialias: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
}

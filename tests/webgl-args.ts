// Chromium flags for WebGL 2 in the browser tests. By default it renders on the GPU through ANGLE's Vulkan backend
// (on the team laptop, the NVIDIA card). E2E_SWIFTSHADER=1 renders in software on the CPU instead, for a machine
// without a usable GPU: much slower, and it keeps every CPU core busy for the whole run.
export const webglArgs = process.env.E2E_SWIFTSHADER
  ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  : ["--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist"];

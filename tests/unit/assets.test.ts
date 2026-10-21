import { Group, Mesh, MeshBasicMaterial, BoxGeometry, type Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { AssetLibrary, AssetLoadError, loadAssets, parseManifest, type LoaderOptions } from "../../src/assets";

const manifestUrl = "https://host.test/game/assets/manifest.json";
const manifest = (...urls: string[]) => ({ files: urls.map((url, i) => ({ id: `m${i}`, url })) });
const model = (name = "model"): Object3D => {
  const group = new Group();
  group.name = name;
  group.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
  return group;
};

/** A loader whose files finish when the test says so. */
function gatedLoader() {
  const gates = new Map<string, { progress: (f: number) => void; finish: () => void; fail: (e: Error) => void }>();
  const loadModel: LoaderOptions["loadModel"] = (url, onProgress) =>
    new Promise((resolve, reject) => {
      gates.set(url, { progress: onProgress, finish: () => resolve(model(url)), fail: reject });
    });
  return { gates, loadModel };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("parseManifest (REQ-009 AC-2)", () => {
  it("accepts an empty list, which is what the game ships with until the models arrive", () => {
    expect(parseManifest({ files: [] })).toEqual([]);
  });

  it.each([
    [null, '"files" must be a list'],
    [{}, '"files" must be a list'],
    [{ files: [{ id: "a" }] }, 'file 0 needs an "id" and a "url"'],
    [{ files: [{ id: "a", url: "a.glb" }, { id: "a", url: "b.glb" }] }, '"a" is listed twice'],
    [{ files: [{ id: "a", url: "a.png" }] }, "not a .glb or .gltf file"],
  ])("rejects %j", (data, message) => {
    expect(() => parseManifest(data)).toThrow(AssetLoadError);
    expect(() => parseManifest(data)).toThrow(message);
  });
});

describe("loadAssets (REQ-009 AC-2)", () => {
  it("reports 0 first and 1 last, and loads nothing for an empty manifest", async () => {
    const onProgress = vi.fn();
    const loadModel = vi.fn();
    await loadAssets(onProgress, { manifestUrl, fetchJson: async () => ({ files: [] }), loadModel }, new AssetLibrary());
    expect(onProgress.mock.calls.map(([f]) => f)).toEqual([0, 1]);
    expect(loadModel).not.toHaveBeenCalled();
  });

  it("resolves model paths against the manifest and reports progress file by file, never going back", async () => {
    const { gates, loadModel } = gatedLoader();
    const seen: number[] = [];
    const library = new AssetLibrary();
    const done = loadAssets((f) => seen.push(f), { manifestUrl, fetchJson: async () => manifest("rov.glb", "models/net.glb"), loadModel }, library);
    await tick();
    expect([...gates.keys()]).toEqual(["https://host.test/game/assets/rov.glb", "https://host.test/game/assets/models/net.glb"]);

    gates.get("https://host.test/game/assets/rov.glb")!.progress(0.5);
    gates.get("https://host.test/game/assets/rov.glb")!.progress(0.2); // a stale event must not move the bar back
    expect(Math.max(...seen)).toBeCloseTo(0.25);
    gates.get("https://host.test/game/assets/rov.glb")!.finish();
    await tick();
    expect(seen.at(-1)).toBeCloseTo(0.5);
    expect(library.has("m0")).toBe(true);
    expect(library.has("m1")).toBe(false);
    gates.get("https://host.test/game/assets/models/net.glb")!.finish();
    await done;
    expect(seen.at(-1)).toBe(1);
    expect(seen.slice(1).every((f, i) => f >= seen[i])).toBe(true);
    expect(library.has("m1")).toBe(true);
  });
});

describe("loadAssets failures (REQ-009 AC-3)", () => {
  const options = (overrides: Partial<LoaderOptions>): Partial<LoaderOptions> => ({ manifestUrl, fetchJson: async () => manifest("a.glb"), ...overrides });

  it("rejects when the manifest cannot be fetched", async () => {
    const fetchJson = async () => {
      throw new TypeError("network down");
    };
    await expect(loadAssets(() => {}, options({ fetchJson }), new AssetLibrary())).rejects.toThrow(AssetLoadError);
  });

  it("rejects when the manifest is malformed", async () => {
    await expect(loadAssets(() => {}, options({ fetchJson: async () => ({ nope: 1 }) }), new AssetLibrary())).rejects.toThrow('"files" must be a list');
  });

  it("rejects, naming the file, when one model fails", async () => {
    const loadModel: LoaderOptions["loadModel"] = async (url) => {
      if (url.endsWith("b.glb")) throw new Error("404");
      return model();
    };
    const run = loadAssets(() => {}, options({ fetchJson: async () => manifest("a.glb", "b.glb"), loadModel }), new AssetLibrary());
    await expect(run).rejects.toThrow(AssetLoadError);
    await expect(run).rejects.toThrow("https://host.test/game/assets/b.glb");
  });
});

describe("AssetLibrary", () => {
  it("hands out independent copies, and null for an unknown id", () => {
    const library = new AssetLibrary();
    library.add("rov", model("rov"));
    const a = library.model("rov")!;
    const b = library.model("rov")!;
    expect(a.name).toBe("rov");
    expect(a).not.toBe(b);
    a.position.set(1, 2, 3);
    expect(b.position.x).toBe(0);
    expect(library.model("missing")).toBeNull();
  });
});

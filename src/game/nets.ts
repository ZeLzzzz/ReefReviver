import { Vector3 } from "three";
import { config } from "../config";
import { floorHeight } from "./bay";

const { nets, cutter } = config;

export type AnimalSpecies = "turtle" | "reefShark";

/** A ghost net: a dome standing on the floor over one trapped animal (D-012). */
export interface Net {
  /** Also the id of the animal inside. */
  id: number;
  species: AnimalSpecies;
  /** The middle of the dome's base, on the floor. */
  center: Vector3;
  /** The dome's long axis points along (sin yaw, cos yaw), like the ROV's facing. */
  yaw: number;
  /** Half-sizes of the dome, in metres. */
  width: number;
  height: number;
  length: number;
  cut: boolean;
  /** Seconds since the net was cut; the view lets it sink away. */
  cutAge: number;
}

/** The nets, always at the same places, each with its own species. */
export function generateNets(): Net[] {
  return nets.sites.map((site, id) => {
    const species = nets.species[site.species];
    return {
      id,
      species: site.species,
      // A little below the floor, so the dome's rim is buried and no gap shows.
      center: new Vector3(site.x, floorHeight(site.x, site.z) - 0.1, site.z),
      yaw: site.yaw,
      width: species.netWidth,
      height: species.netHeight,
      length: species.netLength,
      cut: false,
      cutAge: 0,
    };
  });
}

/** The ghost nets and whether each is still there. Pure: no rendering, no DOM. */
export class NetField {
  readonly nets: Net[] = generateNets();

  get total(): number {
    return this.nets.length;
  }

  /** The nets still holding an animal. */
  get uncut(): Net[] {
    return this.nets.filter((net) => !net.cut);
  }

  /** Cuts the net; a net already cut stays as it is. Returns it. */
  cut(id: number): Net {
    const net = this.nets[id];
    if (!net.cut) {
      net.cut = true;
      net.cutAge = 0;
    }
    return net;
  }

  update(dt: number): void {
    for (const net of this.nets) if (net.cut) net.cutAge = Math.min(net.cutAge + dt, cutter.netFadeSeconds);
  }

  /** Puts every net back, for a new dive. */
  reset(): void {
    for (const net of this.nets) {
      net.cut = false;
      net.cutAge = 0;
    }
  }
}

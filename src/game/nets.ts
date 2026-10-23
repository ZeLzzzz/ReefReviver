import { Vector3 } from "three";
import { config } from "../config";
import { floorHeight } from "./bay";
import { defaultLayout, type Layout } from "./layout";

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

/** The nets of a dive at the layout's spots (REQ-012): net 0 traps the turtle, net 1 the reef shark. */
export function generateNets(layout: Layout = defaultLayout): Net[] {
  return layout.nets.map((site, id) => {
    const kind = nets.kinds[id];
    const species = nets.species[kind];
    return {
      id,
      species: kind,
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
  readonly nets: Net[];

  constructor(layout: Layout = defaultLayout) {
    this.nets = generateNets(layout);
  }

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

  /** Puts every net back, for a new dive, at the new layout's spots when one is given (REQ-012). */
  reset(layout?: Layout): void {
    const fresh = layout ? generateNets(layout) : null;
    this.nets.forEach((net, i) => {
      if (fresh) {
        net.center.copy(fresh[i].center);
        net.yaw = fresh[i].yaw;
      }
      net.cut = false;
      net.cutAge = 0;
    });
  }
}

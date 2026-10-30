// The data behind the Marine Logbook (REQ-007, decisions D-010, D-016, D-027).
// The texts (name, facts, SDG link) live in src/i18n/id.json and en.json under `logbook.<id>.*` (G-004).
// Every fact in those texts is backed by at least one source listed here (G-002). When a source cannot
// back a fact any more, drop the fact and write a sourced one instead. Do not keep it unsourced.

export type LogbookId = "turtle" | "reefShark" | "clownfish" | "mantaRay" | "dolphin" | "coral" | "seagrass";

/** The keys of the three texts of one entry. Typed so a missing string key fails `tsc`. */
export type LogbookTextKey = `logbook.${LogbookId}.${"name" | "facts" | "sdg"}`;

export interface LogbookSource {
  publisher: string;
  title: string;
  url: string;
  /** Which fact (or check) in the entry this source backs. */
  supports: string;
}

export interface LogbookEntry {
  id: LogbookId;
  /** Latin name. Animals only: coral and seagrass stay at group level (D-027). */
  scientificName?: string;
  /** The official SDG 14 target the entry links to, e.g. "14.1". */
  sdgTarget: string;
  sources: LogbookSource[];
}

export function logbookKeys(id: LogbookId): { name: LogbookTextKey; facts: LogbookTextKey; sdg: LogbookTextKey } {
  return { name: `logbook.${id}.name`, facts: `logbook.${id}.facts`, sdg: `logbook.${id}.sdg` };
}

export const UN_SDG14_URL = "https://sdgs.un.org/goals/goal14";

function unTarget(target: string): LogbookSource {
  return {
    publisher: "United Nations, Department of Economic and Social Affairs",
    title: "Goal 14: Conserve and sustainably use the oceans, seas and marine resources",
    url: UN_SDG14_URL,
    supports: `Official text of Target ${target}, which the SDG sentence follows.`,
  };
}

/** The seven entries, in the order of D-016. */
export const LOGBOOK_ENTRIES: readonly LogbookEntry[] = [
  {
    id: "turtle",
    scientificName: "Chelonia mydas",
    sdgTarget: "14.1",
    sources: [
      {
        publisher: "IUCN",
        title: "Chelonia mydas (Green Turtle), The IUCN Red List of Threatened Species 2025",
        url: "https://dx.doi.org/10.2305/IUCN.UK.2025-2.RLTS.T4615A285108125.en",
        supports:
          "Least Concern, assessed 9 December 2024 and published 2025; occurs in Indonesia; herbivorous diet; bycatch and plastic pollution as threats.",
      },
      {
        publisher: "IUCN",
        title: "Arctic seals threatened by climate change, birds decline globally (Red List update, 10 October 2025)",
        url: "https://iucn.org/press-release/202510/arctic-seals-threatened-climate-change-birds-decline-globally-iucn-red-list",
        supports:
          "Status improved from Endangered to Least Concern; numbers still far below those before European colonisation.",
      },
      {
        publisher: "NOAA Fisheries",
        title: "Green Turtle",
        url: "https://www.fisheries.noaa.gov/species/green-turtle",
        supports: "Eats mostly seagrasses and algae; can ingest marine debris such as plastic.",
      },
      {
        publisher: "NOAA Marine Debris Program",
        title: "Wildlife Entanglement and Ghost Fishing",
        url: "https://marinedebris.noaa.gov/why-marine-debris-problem/wildlife-entanglement-and-ghost-fishing",
        supports: "Lost or abandoned fishing gear traps turtles; all seven sea turtle species have been found entangled.",
      },
      unTarget("14.1"),
    ],
  },
  {
    id: "reefShark",
    scientificName: "Carcharhinus melanopterus",
    sdgTarget: "14.4",
    sources: [
      {
        publisher: "IUCN",
        title: "Carcharhinus melanopterus (Blacktip Reef Shark), The IUCN Red List of Threatened Species 2020",
        url: "https://dx.doi.org/10.2305/IUCN.UK.2020-3.RLTS.T39375A58303674.en",
        supports:
          "Vulnerable (A2bcd), assessed 15 July 2020; population decreasing; shallow water on and near coral reefs; occurs in Indonesia; caught in gillnet, longline and handline fisheries, mostly as incidental catch.",
      },
      {
        publisher: "Florida Museum of Natural History",
        title: "Blacktip Reef Shark (Discover Fishes species profile)",
        url: "https://www.floridamuseum.ufl.edu/discover-fish/species-profiles/blacktip-reef-shark/",
        supports:
          "Black fin tips; shallow water near coral reefs; range includes Indonesia; caught by inshore fisheries. (Its status line says Near Threatened, which is older than the 2020 IUCN assessment; it is not used for the status.)",
      },
      unTarget("14.4"),
    ],
  },
  {
    id: "clownfish",
    scientificName: "Amphiprion ocellaris",
    sdgTarget: "14.2",
    sources: [
      {
        publisher: "IUCN",
        title: "Amphiprion ocellaris (Clown Anemonefish), The IUCN Red List of Threatened Species 2022",
        url: "https://dx.doi.org/10.2305/IUCN.UK.2022-2.RLTS.T188321A1857718.en",
        supports:
          "Least Concern, assessed 3 February 2021; sheltered lagoons and coral reefs; lives with sea anemones; up to 11 cm; occurs in Indonesia; aquarium collection and bleaching of host anemones as threats.",
      },
      {
        publisher: "FishBase",
        title: "Amphiprion ocellaris, Clown anemonefish",
        url: "https://fishbase.se/summary/Amphiprion-ocellaris",
        supports: "Lives among the tentacles of large sea anemones on coral reefs; Indo-West Pacific range including Indonesia.",
      },
      unTarget("14.2"),
    ],
  },
  {
    id: "mantaRay",
    scientificName: "Mobula alfredi",
    sdgTarget: "14.4",
    sources: [
      {
        publisher: "IUCN",
        title: "Mobula alfredi (Reef Manta Ray), The IUCN Red List of Threatened Species 2022",
        url: "https://dx.doi.org/10.2305/IUCN.UK.2022-1.RLTS.T195459A214395983.en",
        supports:
          "Vulnerable (A2bcd+3d), assessed 9 November 2018; large ray (the assessment gives up to 500 cm disc width); occurs in Indonesia; gill plates traded; targeted and caught as bycatch.",
      },
      {
        publisher: "Kementerian Kelautan dan Perikanan (KKP), Indonesia",
        title: "Keputusan Menteri Kelautan dan Perikanan Nomor 4/KEPMEN-KP/2014 tentang Penetapan Status Perlindungan Penuh Ikan Pari Manta",
        url: "https://peraturan.bpk.go.id/Download/152471/Kepmen%20KKP%20Nomor%204%20Tahun%202014.pdf",
        supports:
          "Both manta species, including Manta alfredi (Pari Manta Karang), are fully protected in Indonesia from 27 January 2014.",
      },
      {
        publisher: "FishBase",
        title: "Mobula alfredi, Reef manta ray",
        url: "https://fishbase.se/summary/Mobula-alfredi",
        supports: "Feeds on plankton; known aggregation sites include Indonesia.",
      },
      unTarget("14.4"),
    ],
  },
  {
    id: "dolphin",
    scientificName: "Stenella longirostris",
    sdgTarget: "14.1",
    sources: [
      {
        publisher: "IUCN",
        title: "Stenella longirostris (Spinner Dolphin), The IUCN Red List of Threatened Species 2018",
        url: "https://dx.doi.org/10.2305/IUCN.UK.2018-2.RLTS.T20733A50375784.en",
        supports:
          "Least Concern, assessed 20 February 2018; occurs in Indonesia; rests in shallow coastal waters during the day; frequently taken as bycatch.",
      },
      {
        publisher: "NOAA Fisheries",
        title: "Spinner Dolphin",
        url: "https://www.fisheries.noaa.gov/species/spinner-dolphin",
        supports: "Known for leaping and spinning in the air; can ingest or become entangled in marine debris.",
      },
      unTarget("14.1"),
    ],
  },
  {
    id: "coral",
    sdgTarget: "14.3",
    sources: [
      {
        publisher: "NOAA Fisheries",
        title: "Corals",
        url: "https://www.fisheries.noaa.gov/corals",
        supports:
          "Corals are invertebrate animals related to jellyfish and sea anemones; reefs cover under 1% of the ocean floor and support about 25% of marine creatures.",
      },
      {
        publisher: "NOAA National Ocean Service",
        title: "What is ocean acidification?",
        url: "https://oceanservice.noaa.gov/facts/acidification.html",
        supports: "Fewer carbonate ions, the building block of coral skeletons, make it harder for shallow-water corals to build them.",
      },
      unTarget("14.3"),
    ],
  },
  {
    id: "seagrass",
    sdgTarget: "14.2",
    sources: [
      {
        publisher: "UNEP",
        title: "Seagrass meadows",
        url: "https://www.unep.org/en/what-we-do/ocean-seas-and-coasts/blue-ecosystems/seagrass-meadows",
        supports:
          "Marine flowering plants; cover 0.1% of the ocean floor; store up to 18% of oceanic carbon; nursery habitat for fish.",
      },
      {
        publisher: "NOAA Office of National Marine Sanctuaries",
        title: "Seagrass Meadows",
        url: "https://sanctuaries.noaa.gov/visit/ecosystems/seagrass.html",
        supports:
          "Flowering plants, unlike seaweeds (algae); nursery habitat for fish and sea turtles; coastal development and stormwater runoff can damage or smother them.",
      },
      unTarget("14.2"),
    ],
  },
];

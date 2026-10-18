import type { SourceAdapter } from "../../types"
import { arbeitnowAdapter } from "./arbeitnow.adapter"
import { ashbyAdapter } from "./ashby.adapter"
import { bamboohrAdapter } from "./bamboohr.adapter"
import { freshteamAdapter } from "./freshteam.adapter"
import { greenhouseAdapter } from "./greenhouse.adapter"
import { kalibrrAdapter } from "./kalibrr.adapter"
import { leverAdapter } from "./lever.adapter"
import { onlinejobsAdapter } from "./onlinejobs.adapter"
import { remotiveAdapter } from "./remotive.adapter"
import { workdayAdapter } from "./workday.adapter"

/**
 * Every source the pipeline is allowed to run. Adding a provider means adding a
 * file and one entry here; nothing downstream knows which adapter produced a
 * candidate beyond its `provider` id.
 */
export const SOURCE_ADAPTERS: readonly SourceAdapter[] = [
  remotiveAdapter,
  arbeitnowAdapter,
  kalibrrAdapter,
  onlinejobsAdapter,
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  bamboohrAdapter,
  freshteamAdapter,
  workdayAdapter,
]

// Used only by the release audit:
//   NODE_OPTIONS="--require ./scripts/qa/fx-failure-preload.cjs" next start ...
// Every other request keeps the real fetch.
const realFetch = global.fetch

global.fetch = async (input, init) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.href : input?.url ?? ""
  if (String(url).includes("api.frankfurter.dev")) {
    throw new TypeError("QA injected FX outage")
  }
  return realFetch(input, init)
}

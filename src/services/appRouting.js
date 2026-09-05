export const APP_VIEWS = new Set(["home", "about", "news", "board", "records", "bracket", "builder", "titles", "champions"]);

export function readInitialAppView(search = "") {
  const requested = new URLSearchParams(search).get("view");
  return APP_VIEWS.has(requested) ? requested : "home";
}

export function builderRouteSearch(eventId, search = "") {
  const params = new URLSearchParams(search);
  params.set("view", "builder");
  if (eventId) params.set("eventId", eventId);
  else params.delete("eventId");
  return `?${params.toString()}`;
}

export function bracketRouteSearch(eventId, search = "") {
  const params = new URLSearchParams(search);
  params.set("view", "bracket");
  if (eventId) params.set("eventId", eventId);
  else params.delete("eventId");
  return `?${params.toString()}`;
}

import { loadSeason, publicState, json } from "../_lib.js";

export async function onRequestGet({ env }) {
  const s = await loadSeason(env);
  return json(publicState(s, env));
}

// ============================================================================
// YPL 데이터 저장 어댑터
// 우선순위: (1) Claude 아티팩트(window.storage)  (2) Supabase  (3) localStorage
// - Supabase 환경변수가 설정되면 "모든 방문자에게 공유되는" 영구 저장이 됩니다.
// - 설정 안 하면 localStorage로 동작합니다(브라우저 1대에만 저장 = 진짜 공유 아님).
// ============================================================================
import { createClient } from "@supabase/supabase-js";

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 환경변수가 둘 다 있을 때만 Supabase 클라이언트를 만듭니다.
export const supa = SUPA_URL && SUPA_KEY ? createClient(SUPA_URL, SUPA_KEY) : null;

export const STORAGE_MODE = (typeof window !== "undefined" && window.storage)
  ? "artifact"
  : (supa ? "supabase" : "local");

export async function getData(key) {
  // (1) Claude 아티팩트 환경
  if (typeof window !== "undefined" && window.storage) {
    try {
      const r = await window.storage.get(key, true);
      return r ? JSON.parse(r.value) : null;
    } catch { return null; }
  }
  // (2) Supabase
  if (supa) {
    try {
      const { data, error } = await supa
        .from("site_data").select("value").eq("key", key).maybeSingle();
      if (error) { console.error(error); return null; }
      return data ? data.value : null;
    } catch (e) { console.error(e); return null; }
  }
  // (3) localStorage 폴백
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

export async function setData(key, value) {
  if (typeof window !== "undefined" && window.storage) {
    try {
      const r = await window.storage.set(key, JSON.stringify(value), true);
      return !!r;
    } catch { return false; }
  }
  if (supa) {
    try {
      const { error } = await supa
        .from("site_data").upsert({ key, value }, { onConflict: "key" });
      if (error) { console.error(error); return false; }
      return true;
    } catch (e) { console.error(e); return false; }
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}

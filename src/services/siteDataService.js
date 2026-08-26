import { getData, setData } from "../storage.js";

// 운영 사이트의 기존 공유 데이터 키를 한 곳에서 관리한다.
// 이 값은 현재 production Supabase의 site_data / ypl_data_v4와 호환되어야 한다.
export const SITE_DATA_KEY = "ypl_data_v4";

export async function loadSiteData() {
  try {
    return await getData(SITE_DATA_KEY);
  } catch {
    return null;
  }
}

export async function saveSiteData(value) {
  try {
    return await setData(SITE_DATA_KEY, value);
  } catch (error) {
    console.error(error);
    return false;
  }
}

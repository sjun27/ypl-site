// 4단계에서는 기존 클라이언트 관리자 인증 방식을 그대로 유지한다.
// 실제 서버 권한 검증(Supabase Auth/RLS)은 5단계에서 별도로 전환한다.
const ADMINS = [{ id: "yplofficial", pw: "yplofficial123!" }];

export function verifyAdminCredentials(id, pw) {
  return ADMINS.some((admin) => admin.id === String(id || "").trim() && admin.pw === pw);
}

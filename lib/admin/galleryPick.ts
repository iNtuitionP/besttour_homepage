/**
 * 사진 고르기 한 번의 흐름 — 순서와 마무리만 여기 있다(P5-23 리뷰 P2-1). React·DOM·Storage·서버 없음 — 순수 모듈이라 테스트가 곧바로 부른다.
 *
 * 부품(components/admin/GalleryUploader.tsx)은 포트를 잇는다: 한 장 올리기(디코드 → WebP → commitUpload)는 `uploadOne` 이,
 * 토스트·새로고침·요약 배너는 `finish` 가, 고른 장수 줄과 입력칸은 `resetPicker` 가 한다.
 *
 * 규칙
 *   - **어느 길로 끝나든 고른 장수 줄과 입력칸을 한 번 되돌린다**(resetPicker — 리뷰 P2-1).
 *   - 걸러지고 남은 장이 없으면(형식·크기·장수로 전부 걸러짐) 올리지 않고(잠그지도 않고) 곧바로 마무리한다.
 *   - 한 장의 실패(던짐)는 그 장만 "확인 필요"(onThrow)로 두고 나머지는 계속 올린다.
 *   - 잠금(busy)은 finally 에서 푼다 — 무엇이 던지든 업로더가 잠긴 채 남지 않는다(리뷰 F1).
 */
export interface GalleryPickFlow {
  /** 걸러지고 남은(올릴) 장 수. */
  accepted: number;
  /** 걸러진 장 수(형식·크기·장수). */
  rejected: number;
  /** 올리기 전 준비(브라우저 Storage 클라이언트) — 던지면 한 장도 올리지 않고 마무리만 한다. */
  prepare: () => void;
  /** i 번째 장을 올린다 — 올렸으면 true, 그 장이 실패로 끝났으면 false. */
  uploadOne: (index: number) => Promise<boolean>;
  /** i 번째 장에서 예상 못 한 예외 — 그 장만 "확인 필요"(파일이 올라갔는지도 모른다). */
  onThrow: (index: number) => void;
  setBusy: (busy: boolean) => void;
  /** 고른 장수 줄과 입력칸을 되돌린다. */
  resetPicker: () => void;
  /** 끝 — 올라간 장 수 · 올라가지 못한 장 수(걸러진 것 포함). */
  finish: (ok: number, failed: number) => void;
}

export async function runGalleryPick(flow: GalleryPickFlow): Promise<void> {
  if (flow.accepted === 0) {
    // 고른 것이 전부 걸러졌다(형식·크기·장수) — 올릴 것이 없으니 곧바로 요약. 고른 장수 줄·입력칸도 되돌린다(리뷰 P2-1 —
    // 전에는 이 길이 되돌리기 전에 돌아가 "N장을 골랐어요" 가 실패 배너 옆에 남고, 같은 파일을 다시 골라도 change 가 나지 않았다)
    flow.resetPicker();
    flow.finish(0, flow.rejected);
    return;
  }

  flow.setBusy(true);
  let ok = 0;
  try {
    flow.prepare();
    for (let i = 0; i < flow.accepted; i += 1) {
      // 한 장의 실패가 나머지를 멈추지 않는다. 예상 못 한 예외도 여기서 끝난다.
      try {
        if (await flow.uploadOne(i)) ok += 1;
      } catch {
        flow.onThrow(i);
      }
    }
  } finally {
    flow.setBusy(false);
    flow.resetPicker();
    // 올라가지 못한 장 = 고른 장 − 올라간 장
    flow.finish(ok, flow.accepted + flow.rejected - ok);
  }
}

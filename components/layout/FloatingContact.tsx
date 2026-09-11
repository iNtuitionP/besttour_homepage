/**
 * 플로팅 문의 버튼 (P2-3) — 서버 컴포넌트.
 *
 * 전화 · 카카오톡 채널 · 네이버 톡톡 3종. **URL 이 없는 채널은 버튼을 만들지 않는다.**
 * 목업은 아직 주소를 못 받아 href="#" 로 두었는데, 그대로 옮기면 눌러도 아무 일이 없는 버튼이
 * 배포된다. 채널 주소를 받으면 env 만 채우면 버튼이 살아난다.
 *   NEXT_PUBLIC_KAKAO_CHANNEL_URL · NEXT_PUBLIC_NAVER_TALK_URL
 *
 * 접근성 — 버튼 위에 읽어야 하는 텍스트를 올리지 않는다.
 *   네이버 공식 녹색(#03C75A) 위의 흰 글자는 2.25:1 로 AA(4.5:1)에 한참 못 미친다. 색을 바꾸면
 *   브랜드 가이드 위반이라 선택지는 "글자를 올리지 않는다" 하나뿐이다. 그래서 각 버튼은
 *   아이콘 + aria-label 로만 이름을 갖는다(WCAG 1.4.3 은 로고·브랜드 그래픽을 대비 요구에서 제외).
 */

import { getTranslations } from "next-intl/server";

import { COMPANY, LEGAL_LABELS } from "@/lib/legal/disclosures";

import styles from "./FloatingContact.module.css";

type Channel = {
  key: string;
  href: string;
  label: string;
  className: string;
  icon: React.ReactNode;
  external: boolean;
};

const PhoneIcon = (
  <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 3h3.2l1.6 4.2-2.1 1.5a13 13 0 0 0 6.6 6.6l1.5-2.1L20 14.8V18a2 2 0 0 1-2.2 2C10.2 19.3 4.7 13.8 4 6.2A2 2 0 0 1 5 3Z" />
  </svg>
);

const ChatIcon = (
  <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 4c-4.5 0-8.1 2.8-8.1 6.2 0 2.1 1.4 4 3.5 5.1l-.8 3.1c-.1.4.3.7.7.5l3.7-2.3c.3 0 .7.1 1 .1 4.5 0 8.1-2.8 8.1-6.2S16.5 4 12 4Z" />
  </svg>
);

const TalkIcon = (
  <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 4c-4.5 0-8.1 2.7-8.1 6.1 0 2.1 1.4 4 3.5 5.1v3.3c0 .4.5.7.9.4l3.2-2.3c.2 0 .4.1.5.1 4.5 0 8.1-2.7 8.1-6.1S16.5 4 12 4Z" />
  </svg>
);

export default async function FloatingContact() {
  const t = await getTranslations("layout");

  const channels: Channel[] = [
    {
      key: "tel",
      href: COMPANY.tel.trim() === "" ? "" : `tel:${COMPANY.tel}`,
      label: `${LEGAL_LABELS.contact.tel} ${COMPANY.tel}`,
      className: styles.fbtnTel,
      icon: PhoneIcon,
      external: false,
    },
    {
      key: "kakao",
      href: process.env.NEXT_PUBLIC_KAKAO_CHANNEL_URL ?? "",
      label: t("kakaoChannel"),
      className: styles.fbtnKakao,
      icon: ChatIcon,
      external: true,
    },
    {
      key: "naver",
      href: process.env.NEXT_PUBLIC_NAVER_TALK_URL ?? "",
      label: t("naverChannel"),
      className: styles.fbtnNaver,
      icon: TalkIcon,
      external: true,
    },
  ].filter((channel) => channel.href.trim() !== "");

  if (channels.length === 0) return null;

  return (
    <div className={styles.floats} role="group" aria-label={t("contactChannels")}>
      {channels.map((channel) => (
        <a
          key={channel.key}
          className={`${styles.fbtn} ${channel.className}`}
          href={channel.href}
          aria-label={channel.label}
          {...(channel.external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
        >
          {channel.icon}
        </a>
      ))}
    </div>
  );
}

import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * 로케일을 인지하는 네비게이션 래퍼.
 * 공개 화면에서는 next/link 대신 반드시 여기의 Link를 쓴다.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);

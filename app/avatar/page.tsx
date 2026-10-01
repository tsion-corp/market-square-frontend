import type { Metadata } from "next";
import { AvatarStudioScreen } from "@/features/profile/components/avatar-studio-screen";

export const metadata: Metadata = { title: "Create Your Avatar" };

export default function Page() {
  return <AvatarStudioScreen />;
}

import { redirect } from "next/navigation";

// People are managed in Settings → Users now (super admin only).
export default function UsersPage() {
  redirect("/settings#users");
}

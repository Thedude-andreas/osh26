import { getChatGPTUser } from "./chatgpt-auth";
import Osh26App from "./osh26-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return <Osh26App userName={user?.displayName ?? "Guest pilot"} signedIn={Boolean(user)} />;
}

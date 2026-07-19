import Osh26App from "./osh26-app";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Osh26App userName="Guest pilot" signedIn={false} isAdmin={false} />;
}

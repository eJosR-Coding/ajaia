import { User } from "./api";
export default function Editor({ docId }: { docId: number; user: User; onLogout: () => void }) {
  return <div>doc {docId}</div>;
}

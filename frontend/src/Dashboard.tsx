import { User } from "./api";
export default function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  return <div><p>{user.name}</p><button onClick={onLogout}>Log out</button></div>;
}

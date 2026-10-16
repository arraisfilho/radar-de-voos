import { version } from "../package.json";
export function SystemVersion() {
  return <small className="system-version">v{version}</small>;
}

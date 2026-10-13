import { useMemo, useState } from "react";
import { BridgeClient, type BridgeConnection } from "@etabs-bridge/client";
import { ConnectPanel } from "./components/ConnectPanel";
import { Workspace } from "./components/Workspace";
import { loadInitialConnection, saveConnection } from "./state/connection";

export function App() {
  const [connection, setConnection] = useState<BridgeConnection | null>(() => loadInitialConnection());
  const client = useMemo(
    () => (connection ? new BridgeClient({ baseUrl: connection.bridgeUrl, token: connection.token }) : null),
    [connection],
  );

  const connect = (c: BridgeConnection | null) => {
    saveConnection(c);
    setConnection(c);
  };

  if (!client) return <ConnectPanel initial={connection} onConnect={connect} />;
  return <Workspace client={client} onDisconnect={() => connect(null)} />;
}

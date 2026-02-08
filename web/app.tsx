import { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Layout } from "./components/Layout.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Extract } from "./pages/Extract.tsx";
import { Addresses } from "./pages/Addresses.tsx";
import { Transactions } from "./pages/Transactions.tsx";
import { Connections, ClusterDetail } from "./pages/Connections.tsx";
import { AddressDetail } from "./pages/AddressDetail.tsx";

interface Route {
  page: string;
  params: Record<string, string>;
}

function parseHash(): Route {
  const hash = window.location.hash || "#/";
  const path = hash.slice(1); // remove #

  // Match /addresses/:id
  const addressMatch = path.match(/^\/addresses\/(\d+)$/);
  if (addressMatch) {
    return { page: "addressDetail", params: { addressId: addressMatch[1]! } };
  }

  // Match /connections/:id
  const clusterMatch = path.match(/^\/connections\/(\d+)$/);
  if (clusterMatch) {
    return { page: "clusterDetail", params: { clusterId: clusterMatch[1]! } };
  }

  const routes: Record<string, string> = {
    "/": "dashboard",
    "/extract": "extract",
    "/addresses": "addresses",
    "/transactions": "transactions",
    "/connections": "connections",
  };

  return { page: routes[path] ?? "dashboard", params: {} };
}

function App() {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const renderPage = () => {
    switch (route.page) {
      case "dashboard":
        return <Dashboard />;
      case "extract":
        return <Extract />;
      case "addresses":
        return <Addresses />;
      case "addressDetail":
        return <AddressDetail addressId={Number(route.params.addressId)} />;
      case "transactions":
        return <Transactions />;
      case "connections":
        return <Connections />;
      case "clusterDetail":
        return <ClusterDetail clusterId={Number(route.params.clusterId)} />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <Layout currentPage={route.page}>
      {renderPage()}
    </Layout>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<App />);
}

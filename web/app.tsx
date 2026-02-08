import { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Layout } from "./components/Layout.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Extract } from "./pages/Extract.tsx";
import { Addresses } from "./pages/Addresses.tsx";
import { Transactions } from "./pages/Transactions.tsx";
import { Connections, ClusterDetail } from "./pages/Connections.tsx";
import { AddressDetail } from "./pages/AddressDetail.tsx";
import { Setup } from "./pages/Setup.tsx";
import { Settings } from "./pages/Settings.tsx";
import { getConfigStatus } from "./lib/api.ts";

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
    "/settings": "settings",
    "/setup": "setup",
  };

  return { page: routes[path] ?? "dashboard", params: {} };
}

function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [checkingSetup, setCheckingSetup] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Check if first-run setup is needed
  useEffect(() => {
    getConfigStatus()
      .then((status) => {
        if (!status.setupCompletedAt) {
          setNeedsSetup(true);
        }
      })
      .catch(() => {
        // If settings endpoint fails, skip setup check
      })
      .finally(() => setCheckingSetup(false));
  }, []);

  // Show setup page on first run
  if (checkingSetup) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  if (needsSetup && route.page !== "settings") {
    return (
      <Setup
        onComplete={() => {
          setNeedsSetup(false);
          window.location.hash = "#/";
        }}
      />
    );
  }

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
      case "settings":
        return <Settings />;
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

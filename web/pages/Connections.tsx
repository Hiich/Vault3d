import { useState, useEffect, useCallback, useRef } from "react";
import {
  scanConnections,
  getScanState,
  getClusters,
} from "../lib/api.ts";
import type {
  ScanStateData,
  ClusterData,
  ClusterAddress,
} from "../lib/api.ts";
import { truncateAddress, timeAgo, typeBadgeColor } from "../lib/format.ts";

// Declare d3 global from CDN
declare const d3: any;

// --- Wallet color palette for graph nodes ---
const WALLET_COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
  "#06b6d4", "#f97316", "#6366f1", "#84cc16", "#e11d48",
];

function walletColor(walletId: number): string {
  return WALLET_COLORS[walletId % WALLET_COLORS.length]!;
}

function chainBadge(chainType: string) {
  return chainType === "evm"
    ? "bg-blue-600/20 text-blue-400 border-blue-800"
    : "bg-purple-600/20 text-purple-400 border-purple-800";
}

function parseEvidence(evidence: string): { type: string; [key: string]: unknown } {
  try {
    return JSON.parse(evidence);
  } catch {
    return { type: "unknown" };
  }
}

// --- Cluster stats helper ---
function clusterStats(cluster: ClusterData) {
  const direct = cluster.connections.filter((c) => c.connection_type === "direct").length;
  const indirect = cluster.connections.filter((c) => c.connection_type === "indirect").length;
  return { direct, indirect };
}

// --- Force Graph Component ---
function ForceGraph({ clusters, showIndirect }: { clusters: ClusterData[]; showIndirect: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || typeof d3 === "undefined" || clusters.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth;
    const height = 600;

    svg.attr("viewBox", [0, 0, width, height]);

    // Build nodes and links from all clusters
    const nodeMap = new Map<number, ClusterAddress & { clusterIdx: number }>();
    const links: Array<{ source: number; target: number; type: string }> = [];

    // Compute cluster centers for separation
    const clusterCount = clusters.length;
    const centerX = width / 2;
    const centerY = height / 2;
    const clusterRadius = Math.min(width, height) * 0.3;

    const clusterCenters: Array<{ x: number; y: number }> = clusters.map((_, idx) => {
      if (clusterCount === 1) return { x: centerX, y: centerY };
      const angle = (2 * Math.PI * idx) / clusterCount - Math.PI / 2;
      return {
        x: centerX + clusterRadius * Math.cos(angle),
        y: centerY + clusterRadius * Math.sin(angle),
      };
    });

    clusters.forEach((cluster, idx) => {
      for (const addr of cluster.addresses) {
        nodeMap.set(addr.address_id, { ...addr, clusterIdx: idx });
      }
      for (const conn of cluster.connections) {
        if (showIndirect || conn.connection_type === "direct") {
          links.push({
            source: conn.address_id_1,
            target: conn.address_id_2,
            type: conn.connection_type,
          });
        }
      }
    });

    const nodes = [...nodeMap.values()];

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d: any) => d.address_id)
          .distance(120)
      )
      .force("charge", d3.forceManyBody().strength(-400))
      .force("collision", d3.forceCollide().radius(25))
      // Per-cluster gravity to push clusters apart
      .force("x", d3.forceX((d: any) => clusterCenters[d.clusterIdx]?.x ?? centerX).strength(0.15))
      .force("y", d3.forceY((d: any) => clusterCenters[d.clusterIdx]?.y ?? centerY).strength(0.15));

    // Zoom
    const g = svg.append("g");
    svg.call(
      d3.zoom().scaleExtent([0.3, 4]).on("zoom", (event: any) => {
        g.attr("transform", event.transform);
      })
    );

    // Links
    const link = g
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d: any) => (d.type === "direct" ? "#6366f1" : "#4b5563"))
      .attr("stroke-width", (d: any) => (d.type === "direct" ? 2.5 : 1))
      .attr("stroke-dasharray", (d: any) => (d.type === "indirect" ? "4,4" : ""))
      .attr("stroke-opacity", (d: any) => (d.type === "indirect" ? 0.4 : 0.8));

    // Nodes
    const node = g
      .append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", 10)
      .attr("fill", (d: any) => walletColor(d.wallet_id))
      .attr("stroke", "#111827")
      .attr("stroke-width", 1.5)
      .attr("cursor", "pointer")
      .call(
        d3
          .drag()
          .on("start", (event: any, d: any) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event: any, d: any) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event: any, d: any) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Tooltip
    const tooltip = d3
      .select("body")
      .append("div")
      .attr("class", "fixed bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 pointer-events-none z-50 hidden");

    node
      .on("mouseover", (event: any, d: any) => {
        tooltip
          .classed("hidden", false)
          .html(
            `<div class="font-mono mb-1">${truncateAddress(d.address, 8)}</div>` +
            `<div class="text-gray-400">${d.chain_type.toUpperCase()} · ${d.wallet_type}</div>` +
            (d.wallet_label ? `<div class="text-gray-400">${d.wallet_label}</div>` : "") +
            `<div class="text-gray-500 mt-1">${d.wallet_profile}</div>`
          )
          .style("left", event.pageX + 12 + "px")
          .style("top", event.pageY - 10 + "px");
      })
      .on("mousemove", (event: any) => {
        tooltip
          .style("left", event.pageX + 12 + "px")
          .style("top", event.pageY - 10 + "px");
      })
      .on("mouseout", () => {
        tooltip.classed("hidden", true);
      })
      .on("click", (_event: any, d: any) => {
        window.location.hash = `#/addresses/${d.address_id}`;
      });

    // Labels — always visible for small graphs, hidden for large ones
    const totalNodes = nodes.length;
    const showLabels = totalNodes <= 30;

    if (showLabels) {
      const label = g
        .append("g")
        .selectAll("text")
        .data(nodes)
        .join("text")
        .attr("font-size", 9)
        .attr("fill", "#9ca3af")
        .attr("dx", 14)
        .attr("dy", 4)
        .text((d: any) => truncateAddress(d.address, 4));

      simulation.on("tick", () => {
        link
          .attr("x1", (d: any) => d.source.x)
          .attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x)
          .attr("y2", (d: any) => d.target.y);

        node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);
        label.attr("x", (d: any) => d.x).attr("y", (d: any) => d.y);
      });
    } else {
      simulation.on("tick", () => {
        link
          .attr("x1", (d: any) => d.source.x)
          .attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x)
          .attr("y2", (d: any) => d.target.y);

        node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);
      });
    }

    return () => {
      simulation.stop();
      tooltip.remove();
    };
  }, [clusters, showIndirect]);

  return (
    <svg
      ref={svgRef}
      className="w-full bg-gray-900 border border-gray-800 rounded-xl"
      style={{ height: 600 }}
    />
  );
}

// --- Overview Page ---
export function Connections() {
  const [scanState, setScanState] = useState<ScanStateData | null>(null);
  const [clusters, setClusters] = useState<ClusterData[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scanning = scanState?.scanning ?? false;
  const liveProgress = scanState?.liveProgress ?? null;
  const lastResult = scanState?.lastResult ?? null;

  const fetchState = useCallback(async () => {
    try {
      const stateData = await getScanState();
      setScanState(stateData);
      return stateData;
    } catch {
      return null;
    }
  }, []);

  const fetchClusters = useCallback(async () => {
    try {
      const data = await getClusters();
      setClusters(data.clusters);
    } catch {
      // ignore
    }
  }, []);

  // Initial load
  useEffect(() => {
    (async () => {
      setLoading(true);
      const state = await fetchState();
      await fetchClusters();
      setLoading(false);
      // If already scanning (page reload mid-scan), start polling
      if (state?.scanning) startPolling();
    })();
    return () => stopPolling();
  }, []);

  const startPolling = () => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
      const state = await fetchState();
      if (state && !state.scanning) {
        stopPolling();
        await fetchClusters();
      }
    }, 2000);
  };

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const handleScan = async () => {
    setScanError(null);
    try {
      await scanConnections();
      await fetchState();
      startPolling();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed");
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">Connections</h2>
          <p className="text-sm text-gray-500 mt-1">
            Discover links between your wallets via on-chain transfers
          </p>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            scanning
              ? "bg-gray-700 text-gray-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-500 text-white"
          }`}
        >
          {scanning ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Scanning...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              Scan Transfer History
            </>
          )}
        </button>
      </div>

      {/* Scan State Summary */}
      {scanState && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
            <div className="text-xs text-gray-500">Addresses</div>
            <div className="text-lg font-bold mt-1">
              {scanState.scannedAddresses}/{scanState.totalAddresses}
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
            <div className="text-xs text-gray-500">Transfers</div>
            <div className="text-lg font-bold mt-1">{scanState.totalTransfers.toLocaleString()}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
            <div className="text-xs text-gray-500">Connections</div>
            <div className="text-lg font-bold mt-1">{scanState.totalConnections}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
            <div className="text-xs text-gray-500">Last Scan</div>
            <div className="text-sm font-medium mt-1 text-gray-300">
              {scanState.lastScanAt ? timeAgo(scanState.lastScanAt) : "Never"}
            </div>
          </div>
        </div>
      )}

      {/* Live Progress */}
      {scanning && liveProgress && (
        <div className="bg-blue-900/20 border border-blue-800 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-blue-400 font-medium">
              Scanning {liveProgress.currentChain}...
            </span>
            <span className="text-xs text-gray-400">
              {liveProgress.addressesScanned}/{liveProgress.addressesTotal} address-chains
            </span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2 mb-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-500"
              style={{
                width: `${liveProgress.addressesTotal > 0
                  ? (liveProgress.addressesScanned / liveProgress.addressesTotal) * 100
                  : 0}%`,
              }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span className="font-mono">
              {liveProgress.currentAddress
                ? truncateAddress(liveProgress.currentAddress, 6)
                : "..."}
            </span>
            <span>{liveProgress.transfersFound.toLocaleString()} transfers found</span>
          </div>
        </div>
      )}

      {/* Scan Error */}
      {scanError && (
        <div className="bg-red-900/30 border border-red-800 rounded-xl p-4 mb-6 text-sm text-red-400">
          {scanError}
        </div>
      )}

      {/* Last Result (shown when scan just completed) */}
      {!scanning && lastResult && (
        <div className="bg-green-900/20 border border-green-800 rounded-xl p-4 mb-6 text-sm text-green-400">
          Scan complete: {lastResult.transfersFound} new transfers, {lastResult.connectionsFound} connections, {lastResult.clustersFound} clusters
          {lastResult.errors.length > 0 && (
            <div className="mt-2 text-yellow-400">
              {lastResult.errors.length} error{lastResult.errors.length !== 1 ? "s" : ""}:
              <ul className="list-disc list-inside mt-1 text-xs text-yellow-500">
                {lastResult.errors.slice(0, 5).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {lastResult.errors.length > 5 && (
                  <li>...and {lastResult.errors.length - 5} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500 text-sm">Loading connections...</div>
        </div>
      ) : clusters.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.07a4.5 4.5 0 00-6.364-6.364L4.5 8.257" />
          </svg>
          <p className="text-gray-400 text-sm">No connections found yet.</p>
          <p className="text-gray-600 text-xs mt-2">
            Click "Scan Transfer History" to analyze on-chain transfers between your wallets.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-4 text-xs text-gray-500">
            <span>{clusters.length} cluster{clusters.length !== 1 ? "s" : ""}</span>
          </div>

          {/* Cluster Summary Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clusters.map((cluster) => {
              const stats = clusterStats(cluster);
              const addrById = new Map<number, ClusterAddress>();
              for (const addr of cluster.addresses) {
                addrById.set(addr.address_id, addr);
              }
              const directPairs = cluster.connections
                .filter((c) => c.connection_type === "direct")
                .slice(0, 2);
              return (
                <a
                  key={cluster.id}
                  href={`#/connections/${cluster.id}`}
                  className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 hover:bg-gray-900/80 transition-all group"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="bg-blue-600/20 text-blue-400 border border-blue-800 text-xs px-2 py-0.5 rounded-full font-medium">
                      Cluster #{cluster.id}
                    </span>
                    <svg className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>

                  {/* Address pair previews */}
                  {directPairs.length > 0 ? (
                    <div className="space-y-1.5 mb-3">
                      {directPairs.map((conn) => {
                        const a1 = addrById.get(conn.address_id_1);
                        const a2 = addrById.get(conn.address_id_2);
                        return (
                          <div key={conn.id} className="flex items-center gap-1.5 text-xs">
                            <span className="font-mono text-gray-300">{a1 ? truncateAddress(a1.address, 4) : "?"}</span>
                            {a1 && (
                              <span className={`${chainBadge(a1.chain_type)} text-[9px] px-1 py-px rounded border`}>
                                {a1.chain_type.toUpperCase()}
                              </span>
                            )}
                            <span className="text-indigo-400">&harr;</span>
                            <span className="font-mono text-gray-300">{a2 ? truncateAddress(a2.address, 4) : "?"}</span>
                            {a2 && (
                              <span className={`${chainBadge(a2.chain_type)} text-[9px] px-1 py-px rounded border`}>
                                {a2.chain_type.toUpperCase()}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {cluster.addresses.slice(0, 4).map((addr) => (
                        <span key={addr.address_id} className="flex items-center gap-1 text-xs">
                          <span className={`${chainBadge(addr.chain_type)} text-[9px] px-1 py-px rounded border`}>
                            {addr.chain_type.toUpperCase()}
                          </span>
                          <span className="font-mono text-gray-400">{truncateAddress(addr.address, 4)}</span>
                        </span>
                      ))}
                      {cluster.addresses.length > 4 && (
                        <span className="text-xs text-gray-600">+{cluster.addresses.length - 4}</span>
                      )}
                    </div>
                  )}

                  {/* Stats */}
                  <div className="text-xs text-gray-500 pt-2 border-t border-gray-800">
                    {cluster.addresses.length} address{cluster.addresses.length !== 1 ? "es" : ""} · {stats.direct} direct · {stats.indirect.toLocaleString()} indirect
                  </div>
                </a>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// --- Cluster Detail Page ---
export function ClusterDetail({ clusterId }: { clusterId: number }) {
  const [clusters, setClusters] = useState<ClusterData[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"cards" | "graph">("cards");
  const [showIndirect, setShowIndirect] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await getClusters();
        setClusters(data.clusters);
      } catch {
        // ignore
      }
      setLoading(false);
    })();
  }, []);

  const cluster = clusters.find((c) => c.id === clusterId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 text-sm">Loading cluster...</div>
      </div>
    );
  }

  if (!cluster) {
    return (
      <div>
        <a href="#/connections" className="text-sm text-blue-400 hover:text-blue-300 transition-colors inline-flex items-center gap-1 mb-4">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Connections
        </a>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
          <p className="text-gray-400 text-sm">Cluster #{clusterId} not found.</p>
        </div>
      </div>
    );
  }

  const stats = clusterStats(cluster);

  return (
    <div>
      {/* Back link */}
      <a href="#/connections" className="text-sm text-blue-400 hover:text-blue-300 transition-colors inline-flex items-center gap-1 mb-4">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back to Connections
      </a>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <span className="bg-blue-600/20 text-blue-400 border border-blue-800 text-sm px-3 py-1 rounded-full font-medium">
          Cluster #{cluster.id}
        </span>
        <span className="text-sm text-gray-500">
          {cluster.addresses.length} address{cluster.addresses.length !== 1 ? "es" : ""} · {stats.direct} direct · {stats.indirect.toLocaleString()} indirect
        </span>
      </div>

      {/* View Toggle + Controls */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setView("cards")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            view === "cards"
              ? "bg-blue-600/20 text-blue-400 border border-blue-800"
              : "text-gray-400 hover:text-gray-200 border border-gray-800"
          }`}
        >
          Cards
        </button>
        <button
          onClick={() => setView("graph")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            view === "graph"
              ? "bg-blue-600/20 text-blue-400 border border-blue-800"
              : "text-gray-400 hover:text-gray-200 border border-gray-800"
          }`}
        >
          Graph
        </button>

        <div className="ml-auto flex items-center gap-3">
          {view === "graph" && (
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showIndirect}
                onChange={(e) => setShowIndirect(e.target.checked)}
                className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 w-3.5 h-3.5"
              />
              Show indirect
            </label>
          )}
          {view === "graph" && (
            <span className="text-xs text-gray-600">
              Drag nodes · Scroll to zoom · Click to open wallet
            </span>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 bg-indigo-500 rounded" />
          <span>Direct transfer</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 border-t border-dashed border-gray-500" />
          <span>Shared counterparty</span>
        </div>
      </div>

      {view === "graph" ? (
        <ForceGraph clusters={[cluster]} showIndirect={showIndirect} />
      ) : (
        <ClusterCard cluster={cluster} />
      )}
    </div>
  );
}

// --- Cluster Card (flat address list) ---
function ClusterCard({ cluster }: { cluster: ClusterData }) {
  const [showEvidence, setShowEvidence] = useState(false);
  const [showAllIndirect, setShowAllIndirect] = useState(false);

  const directConns = cluster.connections.filter((c) => c.connection_type === "direct");
  const indirectConns = cluster.connections.filter((c) => c.connection_type === "indirect");

  // Build address lookup for connection display
  const addrById = new Map<number, ClusterAddress>();
  for (const addr of cluster.addresses) {
    addrById.set(addr.address_id, addr);
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Flat address list */}
      <div className="p-4 space-y-1">
        {cluster.addresses.map((addr) => (
          <a
            key={addr.address_id}
            href={`#/addresses/${addr.address_id}`}
            className="flex items-center gap-2 py-1 hover:bg-gray-800/50 rounded px-1 -mx-1 transition-colors group"
          >
            <span className={`${chainBadge(addr.chain_type)} text-[10px] px-1.5 py-0.5 rounded border`}>
              {addr.chain_type.toUpperCase()}
            </span>
            <span className="font-mono text-xs text-gray-300">
              {truncateAddress(addr.address, 8)}
            </span>
            <span className="ml-auto flex items-center gap-1.5 text-[10px] text-gray-600 group-hover:text-gray-500">
              <span className={`${typeBadgeColor(addr.wallet_type)} text-white px-1 py-px rounded-full`}>
                {addr.wallet_type.replace("_", " ")}
              </span>
              {addr.wallet_label && <span className="text-gray-500">{addr.wallet_label}</span>}
            </span>
          </a>
        ))}
      </div>

      {/* Direct connections as transfer arrows */}
      {directConns.length > 0 && (
        <div className="border-t border-gray-800 px-4 py-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Direct Transfers</div>
          <div className="space-y-1.5">
            {directConns.map((conn) => {
              const a1 = addrById.get(conn.address_id_1);
              const a2 = addrById.get(conn.address_id_2);
              const ev = parseEvidence(conn.evidence);
              return (
                <div key={conn.id} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-gray-300">
                    {a1 ? truncateAddress(a1.address, 6) : `id:${conn.address_id_1}`}
                  </span>
                  <span className="text-indigo-400">&rarr;</span>
                  <span className="font-mono text-gray-300">
                    {a2 ? truncateAddress(a2.address, 6) : `id:${conn.address_id_2}`}
                  </span>
                  {ev.type === "direct_transfer" && (
                    <span className="text-gray-600">
                      {ev.chain as string}/{ev.token as string}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Indirect connections summary (collapsible) */}
      {indirectConns.length > 0 && (
        <div className="border-t border-gray-800">
          <button
            onClick={() => setShowEvidence(!showEvidence)}
            className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            <span>{indirectConns.length} indirect connection{indirectConns.length !== 1 ? "s" : ""} (shared counterparties)</span>
            <svg
              className={`w-4 h-4 transition-transform ${showEvidence ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          {showEvidence && (
            <div className="px-4 pb-3 space-y-1.5">
              {(showAllIndirect ? indirectConns : indirectConns.slice(0, 20)).map((conn) => {
                const a1 = addrById.get(conn.address_id_1);
                const a2 = addrById.get(conn.address_id_2);
                const ev = parseEvidence(conn.evidence);
                return (
                  <div key={conn.id} className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="font-mono text-gray-400">
                      {a1 ? truncateAddress(a1.address, 4) : `id:${conn.address_id_1}`}
                    </span>
                    <span className="text-gray-600">&harr;</span>
                    <span className="font-mono text-gray-400">
                      {a2 ? truncateAddress(a2.address, 4) : `id:${conn.address_id_2}`}
                    </span>
                    {ev.type === "shared_counterparty" && (
                      <span className="text-gray-600">
                        via <span className="font-mono">{truncateAddress(ev.external_address as string, 4)}</span>
                      </span>
                    )}
                  </div>
                );
              })}
              {!showAllIndirect && indirectConns.length > 20 && (
                <button
                  onClick={() => setShowAllIndirect(true)}
                  className="text-xs text-blue-500 hover:text-blue-400 transition-colors"
                >
                  Show {indirectConns.length - 20} more...
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
